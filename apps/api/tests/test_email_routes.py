"""電子郵件路由測試 — happy path / 401 / 403 / 404 / 批次權限（Phase 3）"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import app
from api.dependencies.auth import get_current_active_user
from api.models.email_message import EmailCampaignRecipient, EmailMessage
from api.models.org import Org, Permission, Position, UserPosition
from api.models.user import User


async def _seed_user(
    db: AsyncSession, email: str, codes: list[str], *, superuser: bool = False
) -> User:
    """建立測試使用者，並透過職位授予指定權限碼。"""
    user = User(
        email=email,
        display_name="測試使用者",
        is_active=True,
        is_verified=True,
        is_superuser=superuser,
    )
    db.add(user)
    await db.flush()
    if codes:
        org = Org(name="測試組織")
        db.add(org)
        await db.flush()
        position = Position(org_id=org.id, name="測試職位")
        db.add(position)
        await db.flush()
        for code in codes:
            db.add(Permission(position_id=position.id, code=code))
        db.add(
            UserPosition(
                user_id=user.id,
                position_id=position.id,
                start_date=date.today(),
                end_date=None,
            )
        )
        await db.flush()
    return user


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


@pytest.mark.asyncio
async def test_create_draft_message_succeeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "sender@school.edu", ["email:send"])
    _override_user(user)

    resp = await client.post(
        "/email/messages",
        json={"subject": "測試信件", "action": "draft"},
    )

    assert resp.status_code == 201
    assert resp.json()["status"] == "draft"


@pytest.mark.asyncio
async def test_create_message_without_auth_returns_401(client: AsyncClient) -> None:
    resp = await client.post("/email/messages", json={"subject": "x", "action": "draft"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_message_without_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "nobody@school.edu", [])
    _override_user(user)

    resp = await client.post("/email/messages", json={"subject": "x", "action": "draft"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_missing_message_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "sender2@school.edu", ["email:send"])
    _override_user(user)

    resp = await client.get(f"/email/messages/{uuid.uuid4()}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_bulk_recipients_without_bulk_permission_returns_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _seed_user(db_session, "sender3@school.edu", ["email:send"])
    _override_user(user)

    resp = await client.post(
        "/email/messages",
        json={
            "subject": "群發信",
            "action": "draft",
            "recipients": {"org_ids": [str(uuid.uuid4())]},
        },
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_preview_recipients_resolves_position_members(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    sender = await _seed_user(db_session, "bulk@school.edu", ["email:send_bulk"])
    # sender 的職位即可作為收件目標（sender 本人在任）
    position_id = (
        await db_session.execute(
            select(UserPosition.position_id).where(UserPosition.user_id == sender.id)
        )
    ).scalar_one()
    _override_user(sender)

    resp = await client.post(
        "/email/preview-recipients",
        json={"position_ids": [str(position_id)]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["recipient_count"] == 1
    assert "測試使用者" in body["sample_names"]


@pytest.mark.asyncio
async def test_external_email_recipients_can_be_previewed_and_saved(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = await _seed_user(db_session, "external-sender@school.edu", ["email:send"])
    _override_user(user)
    monkeypatch.setattr("api.routers.email.enqueue_rendered", lambda *args, **kwargs: ["task-id"])

    preview_resp = await client.post(
        "/email/preview-recipients",
        json={"external_emails": ["outsider@example.org", "OUTSIDER@example.org"]},
    )
    assert preview_resp.status_code == 200
    assert preview_resp.json()["recipient_count"] == 1

    create_resp = await client.post(
        "/email/messages",
        json={
            "subject": "外部通知",
            "action": "draft",
            "recipients": {"external_emails": ["outsider@example.org"]},
        },
    )
    assert create_resp.status_code == 201

    message_id = uuid.UUID(create_resp.json()["id"])
    message = await db_session.get(EmailMessage, message_id)
    assert message is not None
    assert message.recipient_spec["external_emails"] == ["outsider@example.org"]

    send_resp = await client.post(
        "/email/messages",
        json={
            "subject": "外部即時通知",
            "action": "send",
            "recipients": {"external_emails": ["outside-now@example.org"]},
        },
    )
    assert send_resp.status_code == 201
    assert send_resp.json()["status"] == "queued"

    recipient = (
        await db_session.execute(
            select(EmailCampaignRecipient).where(
                EmailCampaignRecipient.email == "outside-now@example.org"
            )
        )
    ).scalar_one()
    assert recipient.user_id is None


@pytest.mark.asyncio
async def test_recipient_table_overrides_name_and_uses_chinese_placeholder(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    sender = await _seed_user(db_session, "table-sender@school.edu", ["email:send"])
    recipient_user = User(
        email="accepted@school.edu",
        display_name="帳號原姓名",
        is_active=True,
        is_verified=True,
    )
    db_session.add(recipient_user)
    await db_session.flush()
    _override_user(sender)
    monkeypatch.setattr("api.routers.email.enqueue_rendered", lambda *args, **kwargs: ["task-id"])

    response = await client.post(
        "/email/messages",
        json={
            "subject": "{{ user.name }} 錄取通知",
            "body": "您已錄取 {{ 錄取部門 }}。",
            "action": "send",
            "recipients": {"user_ids": [str(recipient_user.id)]},
            "variable_definitions": [
                {"key": "錄取部門", "label": "錄取部門", "required": True}
            ],
            "recipient_variables": [
                {
                    "email": recipient_user.email,
                    "name": "表格姓名",
                    "variables": {"錄取部門": "活動部"},
                }
            ],
        },
    )

    assert response.status_code == 201
    message_id = response.json()["id"]
    recipient = (
        await db_session.execute(
            select(EmailCampaignRecipient).where(
                EmailCampaignRecipient.email == recipient_user.email
            )
        )
    ).scalar_one()
    assert recipient.name == "表格姓名"
    assert recipient.variables == {"錄取部門": "活動部"}

    preview_response = await client.get(
        f"/email/messages/{message_id}/recipients/{recipient.id}/preview"
    )
    assert preview_response.status_code == 200
    assert "表格姓名 錄取通知" in preview_response.json()["html"]
    assert "您已錄取 活動部。" in preview_response.json()["html"]


@pytest.mark.asyncio
async def test_compose_preview_can_switch_to_specific_recipient(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    sender = await _seed_user(db_session, "preview-sender@school.edu", ["email:send"])
    _override_user(sender)

    response = await client.post(
        "/email/preview",
        json={
            "subject": "{{ user.name }} 的通知",
            "body": "錄取部門：{{ 錄取部門 }}",
            "variable_definitions": [
                {"key": "錄取部門", "label": "錄取部門", "required": True}
            ],
            "preview_recipient": {
                "email": "specific@example.org",
                "name": "特定使用者",
                "variables": {"錄取部門": "公關部"},
            },
        },
    )

    assert response.status_code == 200
    assert "特定使用者 的通知" in response.json()["html"]
    assert "錄取部門：公關部" in response.json()["html"]


@pytest.mark.asyncio
async def test_resolve_recipients_include_school_filters_by_domain(
    db_session: AsyncSession,
) -> None:
    from api.services.recipient import resolve_recipients

    school = User(
        email="stu@hchs.hc.edu.tw", display_name="校內生", is_active=True, is_verified=True
    )
    external = User(
        email="admin@gmail.com", display_name="校外管理員", is_active=True, is_verified=True
    )
    db_session.add_all([school, external])
    await db_session.flush()

    _u1, school_emails = await resolve_recipients(db_session, include_school=True)
    assert "stu@hchs.hc.edu.tw" in school_emails
    assert "admin@gmail.com" not in school_emails

    _u2, all_emails = await resolve_recipients(db_session, include_all=True)
    assert "stu@hchs.hc.edu.tw" in all_emails
    assert "admin@gmail.com" in all_emails
