"""Request ID middleware for log/audit correlation."""

from __future__ import annotations

import re
import uuid
from contextvars import Token

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from api.core.structured_logging import reset_request_id, set_request_id
from api.core.trace_context import (
    TRACE_ID_HEADER,
    TRACEPARENT_HEADER,
    normalize_trace_id,
    reset_trace_id,
    set_trace_id,
)

REQUEST_ID_HEADER = "X-Request-ID"
ERROR_ID_HEADER = "X-Error-ID"
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def normalize_request_id(value: str | None) -> str:
    if value and _SAFE_REQUEST_ID.fullmatch(value):
        return value
    return uuid.uuid4().hex


def _incoming_request_id(scope: Scope) -> str | None:
    for key, value in scope.get("headers") or []:
        if key.lower() == b"x-request-id":
            try:
                return value.decode("latin-1")
            except UnicodeDecodeError:
                return None
    return None


def _incoming_trace_id(scope: Scope) -> str | None:
    for key, value in scope.get("headers") or []:
        if key.lower() not in {TRACE_ID_HEADER.lower().encode(), TRACEPARENT_HEADER.encode()}:
            continue
        try:
            return value.decode("latin-1")
        except UnicodeDecodeError:
            return None
    return None


class RequestIDMiddleware:
    """Attach a stable request id to `scope["state"]` and every response.

    Pure ASGI；不依賴 BaseHTTPMiddleware（後者每個請求都多開一層 anyio task group）。
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = normalize_request_id(_incoming_request_id(scope))
        trace_id = normalize_trace_id(_incoming_trace_id(scope))
        scope.setdefault("state", {})["request_id"] = request_id
        scope["state"]["trace_id"] = trace_id
        request_token = set_request_id(request_id)
        trace_token: Token[str | None] = set_trace_id(trace_id)

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(raw=list(message.get("headers") or []))
                headers[REQUEST_ID_HEADER] = request_id
                headers[TRACE_ID_HEADER] = trace_id
                error_id = scope.get("state", {}).get("error_id")
                if error_id:
                    headers[ERROR_ID_HEADER] = str(error_id)
                message = {**message, "headers": headers.raw}
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            reset_trace_id(trace_token)
            reset_request_id(request_token)


__all__ = [
    "ERROR_ID_HEADER",
    "REQUEST_ID_HEADER",
    "RequestIDMiddleware",
    "normalize_request_id",
]
