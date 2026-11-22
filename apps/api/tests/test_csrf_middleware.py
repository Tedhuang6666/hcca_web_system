"""CSRF middleware cookie attributes and log privacy regressions."""

from __future__ import annotations

from collections.abc import Sequence

import pytest
from starlette.responses import Response
from starlette.types import Message, Receive, Scope, Send

from api.core.csrf import CSRFMiddleware


async def _response_messages(
    *,
    secure: bool,
    method: str,
    headers: Sequence[tuple[bytes, bytes]] = (),
) -> list[Message]:
    scope: Scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "https",
        "path": "/resource",
        "raw_path": b"/resource",
        "query_string": b"",
        "headers": list(headers),
        "server": ("test", 443),
        "client": ("198.51.100.24", 12345),
        "state": {},
    }
    messages: list[Message] = []

    async def app(scope: Scope, receive: Receive, send: Send) -> None:
        await Response("ok")(scope, receive, send)

    async def receive() -> Message:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: Message) -> None:
        messages.append(message)

    await CSRFMiddleware(app, secure=secure)(scope, receive, send)
    return messages


def _response_headers(messages: list[Message]) -> dict[bytes, bytes]:
    start = next(message for message in messages if message["type"] == "http.response.start")
    return {key.lower(): value for key, value in start.get("headers", [])}


@pytest.mark.asyncio
async def test_secure_csrf_cookie_uses_host_prefix_and_required_attributes() -> None:
    messages = await _response_messages(secure=True, method="GET")

    cookie = _response_headers(messages)[b"set-cookie"].decode("latin-1")
    assert cookie.startswith("__Host-csrf_token=")
    assert "Secure" in cookie
    assert "Path=/" in cookie
    assert "Domain=" not in cookie
    assert "HttpOnly" not in cookie


@pytest.mark.asyncio
async def test_secure_csrf_accepts_only_host_prefixed_cookie() -> None:
    messages = await _response_messages(
        secure=True,
        method="POST",
        headers=[
            (b"cookie", b"__Host-csrf_token=nonce"),
            (b"x-csrf-token", b"nonce"),
        ],
    )

    start = next(message for message in messages if message["type"] == "http.response.start")
    body = next(message for message in messages if message["type"] == "http.response.body")
    assert start["status"] == 200
    assert body["body"] == b"ok"


@pytest.mark.asyncio
async def test_secure_csrf_rejects_legacy_cookie_without_logging_ip(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("WARNING", logger="api.core.csrf")
    messages = await _response_messages(
        secure=True,
        method="POST",
        headers=[(b"cookie", b"csrf_token=nonce"), (b"x-csrf-token", b"nonce")],
    )

    assert _response_headers(messages)[b"content-type"].startswith(b"application/json")
    assert caplog.records
    assert all("client_ip" not in record.__dict__ for record in caplog.records)
    assert all("198.51.100.24" not in record.getMessage() for record in caplog.records)
