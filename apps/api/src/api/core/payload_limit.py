"""請求 payload 大小限制 middleware — 防止超大 body 耗盡記憶體。

策略：
  - 看 Content-Type 決定上限（JSON 端點 2MB、multipart/form-data 25MB）
  - 優先採信 Content-Length header；若無，包 receive() 累計 byte 數
    達閾值即中斷，回 413 Payload Too Large

multipart 路徑通常已透過 [storage.py] 做檔案層級的 20MB 限制與白名單；
本 middleware 是「最外層粗篩」，保護那些**還沒進到 router** 就送來巨大 body
的攻擊向量（如惡意 POST /announcements 帶 1GB JSON）。
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from starlette.responses import JSONResponse
from starlette.types import Message, Receive, Scope, Send

logger = logging.getLogger(__name__)


def _content_type(scope: Scope) -> str:
    for k, v in scope.get("headers") or []:
        if k.lower() == b"content-type":
            try:
                return v.decode("latin-1").lower()
            except UnicodeDecodeError:
                return ""
    return ""


def _content_length(scope: Scope) -> int | None:
    for k, v in scope.get("headers") or []:
        if k.lower() == b"content-length":
            try:
                return int(v.decode("ascii"))
            except (ValueError, UnicodeDecodeError):
                return None
    return None


class PayloadLimitMiddleware:
    """
    對 HTTP 請求 body 套用大小上限。

    對 GET / HEAD / DELETE / OPTIONS 直接放行（無 body 慣例）。
    對 multipart/form-data 套用較寬鬆的上限（檔案上傳）。
    其他（JSON / form-urlencoded 等）套用較嚴格的上限。
    """

    _METHODS_WITH_BODY = frozenset({"POST", "PUT", "PATCH"})

    def __init__(
        self,
        app: Callable[[Scope, Receive, Send], Awaitable[None]],
        *,
        max_bytes_json: int,
        max_bytes_multipart: int,
    ) -> None:
        self.app = app
        self.max_bytes_json = max_bytes_json
        self.max_bytes_multipart = max_bytes_multipart

    def _limit_for(self, scope: Scope) -> int:
        ct = _content_type(scope)
        if ct.startswith("multipart/form-data"):
            return self.max_bytes_multipart
        return self.max_bytes_json

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        if method not in self._METHODS_WITH_BODY:
            await self.app(scope, receive, send)
            return

        limit = self._limit_for(scope)

        declared = _content_length(scope)
        if declared is not None and declared > limit:
            await self._reject(scope, send, declared, limit)
            return

        # 沒有 Content-Length（chunked）或 declared 在範圍內：包 receive 監控
        consumed = 0
        rejected = False

        async def guarded_receive() -> Message:
            nonlocal consumed, rejected
            message = await receive()
            if message["type"] == "http.request":
                body = message.get("body") or b""
                consumed += len(body)
                if consumed > limit:
                    rejected = True
                    # 把這個 chunk 改成 empty + more_body=False，讓下游收到 EOF
                    message = {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def guarded_send(message: Message) -> None:
            # 若已經拒絕，吞掉下游回應；不過實際上下游 endpoint 應該已收到 EOF
            # 並可能回 422/400；無論如何我們不能在 response started 後改 status。
            if rejected and message["type"] in ("http.response.start", "http.response.body"):
                return
            await send(message)

        await self.app(scope, guarded_receive, guarded_send)

        if rejected:
            await self._send_413(send, consumed, limit)

    @staticmethod
    async def _reject(scope: Scope, send: Send, declared: int, limit: int) -> None:
        logger.warning(
            "Reject oversized payload path=%s declared=%d limit=%d",
            scope.get("path"),
            declared,
            limit,
        )
        resp = JSONResponse(
            {"detail": f"Payload 超過上限（{limit} bytes）"},
            status_code=413,
        )
        await resp(scope, receive=_dummy_receive, send=send)

    @staticmethod
    async def _send_413(send: Send, consumed: int, limit: int) -> None:
        body = b'{"detail":"Payload \xe8\xb6\x85\xe9\x81\x8e\xe4\xb8\x8a\xe9\x99\x90"}'
        try:
            await send(
                {
                    "type": "http.response.start",
                    "status": 413,
                    "headers": [
                        (b"content-type", b"application/json; charset=utf-8"),
                        (b"content-length", str(len(body)).encode("ascii")),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body, "more_body": False})
        except Exception:
            # 下游可能已開始發 response，這時無法覆蓋；只能記 log
            logger.warning(
                "Late payload reject couldn't send 413 (consumed=%d limit=%d)",
                consumed,
                limit,
            )


async def _dummy_receive() -> Message:
    return {"type": "http.disconnect"}
