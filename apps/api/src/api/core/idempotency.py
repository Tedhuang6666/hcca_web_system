"""HTTP idempotency middleware for explicit client retries."""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from redis.exceptions import RedisError
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from api.core.config import settings
from api.core.security import redis_client

logger = logging.getLogger(__name__)

IDEMPOTENCY_HEADER = "Idempotency-Key"
_SAFE_HEADER_ALLOWLIST = {
    b"content-type",
    b"location",
    b"cache-control",
}


def _header_value(headers: list[tuple[bytes, bytes]], name: bytes) -> str | None:
    lowered = name.lower()
    for key, value in headers:
        if key.lower() == lowered:
            return value.decode("latin-1")
    return None


def _body_hash(method: str, path: str, body: bytes) -> str:
    digest = hashlib.sha256()
    digest.update(method.encode())
    digest.update(b"\0")
    digest.update(path.encode())
    digest.update(b"\0")
    digest.update(body)
    return digest.hexdigest()


def _scope_fingerprint(scope: Scope) -> str:
    headers = list(scope.get("headers") or [])
    auth = _header_value(headers, b"authorization") or ""
    cookie = _header_value(headers, b"cookie") or ""
    client = scope.get("client") or ("unknown", 0)
    digest = hashlib.sha256()
    digest.update(str(client[0]).encode())
    digest.update(b"\0")
    digest.update(auth.encode())
    digest.update(b"\0")
    digest.update(cookie.encode())
    return digest.hexdigest()[:32]


def _cacheable_headers(headers: list[tuple[bytes, bytes]]) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    for key, value in headers:
        if key.lower() in _SAFE_HEADER_ALLOWLIST:
            result.append((key.decode("latin-1"), value.decode("latin-1")))
    return result


class IdempotencyMiddleware:
    """Cache successful explicit-retry responses by Idempotency-Key.

    Clients opt in by sending `Idempotency-Key` on unsafe methods. Reusing the
    same key with a different body returns 409, preventing duplicate creates
    caused by repeated clicks or network retries.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not settings.IDEMPOTENCY_ENABLED:
            await self.app(scope, receive, send)
            return

        method = str(scope.get("method", "GET")).upper()
        if method not in settings.IDEMPOTENCY_METHODS:
            await self.app(scope, receive, send)
            return

        headers = list(scope.get("headers") or [])
        key = _header_value(headers, IDEMPOTENCY_HEADER.encode())
        if not key:
            await self.app(scope, receive, send)
            return
        if len(key) > 128:
            response = JSONResponse({"detail": "Idempotency-Key 過長"}, status_code=400)
            await response(scope, receive, send)
            return

        body = await self._read_body(receive)
        body_hash = _body_hash(method, str(scope.get("path") or ""), body)
        namespace = _scope_fingerprint(scope)
        cache_key = f"idempotency:{namespace}:{method}:{scope.get('path')}:{key}"
        lock_key = f"{cache_key}:lock"

        cached = await self._get_cached(cache_key)
        if cached is not None:
            if cached.get("body_hash") != body_hash:
                response = JSONResponse(
                    {"detail": "Idempotency-Key 已被不同請求內容使用"},
                    status_code=409,
                )
                await response(scope, receive, send)
                return
            await self._send_cached(scope, receive, send, cached)
            return

        if not await self._acquire_lock(lock_key, body_hash):
            response = JSONResponse(
                {"detail": "相同 Idempotency-Key 的請求仍在處理中"},
                status_code=409,
                headers={"Retry-After": str(settings.IDEMPOTENCY_LOCK_TTL_SECONDS)},
            )
            await response(scope, receive, send)
            return

        response_start: Message | None = None
        response_body = bytearray()
        body_sent = False

        async def replay_receive() -> Message:
            nonlocal body_sent
            if body_sent:
                return {"type": "http.request", "body": b"", "more_body": False}
            body_sent = True
            return {"type": "http.request", "body": body, "more_body": False}

        async def capture_send(message: Message) -> None:
            nonlocal response_start
            if message["type"] == "http.response.start":
                response_start = message
            elif message["type"] == "http.response.body":
                response_body.extend(message.get("body", b""))
            await send(message)

        try:
            await self.app(scope, replay_receive, capture_send)
        finally:
            await self._release_lock(lock_key)

        if response_start is None:
            return
        status_code = int(response_start.get("status", 500))
        if 200 <= status_code < 500 and status_code not in {409, 429}:
            await self._store_cached(
                cache_key,
                {
                    "body_hash": body_hash,
                    "status_code": status_code,
                    "headers": _cacheable_headers(response_start.get("headers", [])),
                    "body": response_body.decode("latin-1"),
                },
            )

    async def _read_body(self, receive: Receive) -> bytes:
        chunks: list[bytes] = []
        while True:
            message = await receive()
            if message["type"] != "http.request":
                continue
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        return b"".join(chunks)

    async def _get_cached(self, key: str) -> dict[str, Any] | None:
        try:
            raw = await redis_client.get(key)
        except RedisError:
            logger.warning("Idempotency cache read failed; bypassing cache", exc_info=True)
            return None
        if not raw:
            return None
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None

    async def _store_cached(self, key: str, value: dict[str, Any]) -> None:
        try:
            await redis_client.set(
                key,
                json.dumps(value, ensure_ascii=False),
                ex=settings.IDEMPOTENCY_TTL_SECONDS,
            )
        except RedisError:
            logger.warning("Idempotency cache write failed", exc_info=True)

    async def _acquire_lock(self, key: str, body_hash: str) -> bool:
        try:
            return bool(
                await redis_client.set(
                    key,
                    body_hash,
                    ex=settings.IDEMPOTENCY_LOCK_TTL_SECONDS,
                    nx=True,
                )
            )
        except RedisError:
            logger.warning("Idempotency lock unavailable; bypassing lock", exc_info=True)
            return True

    async def _release_lock(self, key: str) -> None:
        try:
            await redis_client.delete(key)
        except RedisError:
            logger.debug("Idempotency lock release failed", exc_info=True)

    async def _send_cached(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        cached: dict[str, Any],
    ) -> None:
        headers = dict(cached.get("headers") or [])
        headers["X-Idempotent-Replay"] = "true"
        response = Response(
            content=str(cached.get("body", "")).encode("latin-1"),
            status_code=int(cached.get("status_code") or 200),
            headers=headers,
        )
        await response(scope, receive, send)


__all__ = ["IDEMPOTENCY_HEADER", "IdempotencyMiddleware"]
