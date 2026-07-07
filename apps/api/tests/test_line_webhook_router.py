"""LINE Bot Webhook 路由測試（apps/api/src/api/routers/line_webhook.py）。

服務層綁定邏輯已由 test_line_bot_service.py 涵蓋；本檔補齊 HTTP 層：簽名驗證、
未設定時的降級、綁定碼／查詢／解除綁定／自動登入、管理員狀態查詢。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.user import User
from api.services import line_bot as line_bot_svc

_SECRET = "test-line-channel-secret"


def _sign(body: str) -> str:
    digest = hmac.new(_SECRET.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


@pytest.fixture
def line_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "LINE_CHANNEL_SECRET", _SECRET)
    monkeypatch.setattr(settings, "LINE_CHANNEL_ACCESS_TOKEN", "test-access-token")


async def test_webhook_not_configured_returns_503(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "LINE_CHANNEL_SECRET", "")
    monkeypatch.setattr(settings, "LINE_CHANNEL_ACCESS_TOKEN", "")
    response = await client.post(
        "/line/webhook", content="{}", headers={"X-Line-Signature": "anything"}
    )
    assert response.status_code == 503


async def test_webhook_missing_signature_header_returns_422(client: AsyncClient) -> None:
    response = await client.post("/line/webhook", content="{}")
    assert response.status_code == 422


async def test_webhook_invalid_signature_returns_400(
    client: AsyncClient, line_configured: None
) -> None:
    response = await client.post(
        "/line/webhook", content="{}", headers={"X-Line-Signature": "not-a-valid-signature"}
    )
    assert response.status_code == 400


async def test_webhook_malformed_json_returns_400(
    client: AsyncClient, line_configured: None
) -> None:
    body = "not json"
    response = await client.post(
        "/line/webhook", content=body, headers={"X-Line-Signature": _sign(body)}
    )
    assert response.status_code == 400


async def test_webhook_valid_signature_empty_events_returns_ok(
    client: AsyncClient, line_configured: None
) -> None:
    body = json.dumps({"events": []})
    response = await client.post(
        "/line/webhook", content=body, headers={"X-Line-Signature": _sign(body)}
    )
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_webhook_help_command_replies_via_line_api(
    client: AsyncClient, line_configured: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    reply_mock = AsyncMock()
    monkeypatch.setattr(line_bot_svc, "reply_text_message", reply_mock)
    body = json.dumps(
        {
            "events": [
                {
                    "type": "message",
                    "replyToken": "reply-token-abc",
                    "source": {"userId": "U-unbound-user"},
                    "message": {"type": "text", "text": "說明"},
                }
            ]
        }
    )
    response = await client.post(
        "/line/webhook", content=body, headers={"X-Line-Signature": _sign(body)}
    )
    assert response.status_code == 200
    reply_mock.assert_awaited_once()
    call_args = reply_mock.call_args
    assert call_args.args[0] == "reply-token-abc"
    assert "綁定" in call_args.args[1]


async def test_webhook_non_message_event_ignored(
    client: AsyncClient, line_configured: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    reply_mock = AsyncMock()
    monkeypatch.setattr(line_bot_svc, "reply_text_message", reply_mock)
    body = json.dumps({"events": [{"type": "follow", "source": {"userId": "U-x"}}]})
    response = await client.post(
        "/line/webhook", content=body, headers={"X-Line-Signature": _sign(body)}
    )
    assert response.status_code == 200
    reply_mock.assert_not_awaited()


# ── 綁定 / 查詢 / 解除 ────────────────────────────────────────────────────────


async def test_create_link_code_requires_login(client: AsyncClient) -> None:
    response = await client.post("/line/link-code")
    assert response.status_code == 401


async def test_create_link_code_returns_instructions(
    authed_client_factory, member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.post("/line/link-code")
    assert response.status_code == 200
    body = response.json()
    assert len(body["code"]) == 8
    assert body["code"] in body["instructions"]


async def test_get_my_line_binding_unlinked_by_default(
    authed_client_factory, member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/line/me")
    assert response.status_code == 200
    assert response.json()["linked"] is False


async def test_delete_my_line_binding_when_not_linked_is_noop(
    authed_client_factory, member_user: User
) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.delete("/line/me")
    assert response.status_code == 204


async def test_get_my_line_binding_reflects_existing_link(
    authed_client_factory, member_user: User, db_session: AsyncSession
) -> None:
    from datetime import UTC, datetime

    from api.models.line_account import LineAccountLink

    link = LineAccountLink(
        id=uuid.uuid4(),
        user_id=member_user.id,
        line_user_id="U-existing",
        line_display_name="測試使用者",
        is_active=True,
        linked_at=datetime.now(UTC),
    )
    db_session.add(link)
    await db_session.flush()

    ac = authed_client_factory(member_user)
    response = await ac.get("/line/me")
    assert response.status_code == 200
    body = response.json()
    assert body["linked"] is True
    assert body["line_display_name"] == "測試使用者"


# ── 自動登入 ──────────────────────────────────────────────────────────────────


async def test_open_from_line_invalid_token_redirects_to_login(client: AsyncClient) -> None:
    response = await client.get("/line/open", params={"token": "no-such-token"})
    assert response.status_code in (302, 307)
    assert "/login" in response.headers["location"]


async def test_open_from_line_valid_token_sets_cookies(
    client: AsyncClient, member_user: User
) -> None:
    token = await line_bot_svc.create_open_url(member_user.id, "/dashboard")
    parsed_token = token.rsplit("token=", 1)[-1]

    response = await client.get("/line/open", params={"token": parsed_token})
    assert response.status_code in (302, 307)
    assert response.headers["location"].endswith("/dashboard")
    assert settings.ACCESS_TOKEN_COOKIE_NAME in response.cookies


# ── 管理員狀態查詢 ────────────────────────────────────────────────────────────


async def test_line_status_requires_admin_all(authed_client_factory, member_user: User) -> None:
    ac = authed_client_factory(member_user)
    response = await ac.get("/line/status")
    assert response.status_code == 403


async def test_line_status_reports_configured(
    authed_client_factory, admin_user: User, line_configured: None
) -> None:
    ac = authed_client_factory(admin_user)
    response = await ac.get("/line/status")
    assert response.status_code == 200
    assert response.json()["configured"] is True
