from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api import app
from api.dependencies.auth import get_current_active_user
from api.models.email_message import (
    EmailCampaignRecipient,
    EmailMessage,
    EmailSuppression,
)
from api.models.user import User
from api.services import email_platform as platform_svc


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


async def _superuser(db: AsyncSession) -> User:
    user = User(
        email=f"email-admin-{uuid.uuid4().hex[:8]}@school.edu",
        display_name="郵件管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    db.add(user)
    await db.flush()
    return user


@pytest.mark.asyncio
async def test_private_template_crud_and_versioning(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    _override_user(user)
    created = await client.post(
        "/email/templates",
        json={
            "name": "錄取通知",
            "visibility": "private",
            "content": {"subject": "{{ user.name }} 錄取通知", "body": "內容"},
            "variable_definitions": [{"key": "錄取部門", "label": "錄取部門"}],
        },
    )
    assert created.status_code == 201
    template_id = created.json()["id"]

    updated = await client.patch(
        f"/email/templates/{template_id}",
        json={"content": {"subject": "第二版", "body": "更新內容"}},
    )
    assert updated.status_code == 200
    assert updated.json()["current_version"] == 2

    versions = await client.get(f"/email/templates/{template_id}/versions")
    assert versions.status_code == 200
    assert [row["version"] for row in versions.json()] == [2, 1]


@pytest.mark.asyncio
async def test_recipient_list_deduplicates_email(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    _override_user(user)
    response = await client.post(
        "/email/recipient-lists",
        json={
            "name": "錄取名單",
            "visibility": "private",
            "members": [
                {"email": "USER@example.org", "name": "第一筆", "variables": {}},
                {"email": "user@example.org", "name": "重複", "variables": {}},
            ],
        },
    )
    assert response.status_code == 201
    assert len(response.json()["members"]) == 1
    assert response.json()["members"][0]["email"] == "user@example.org"


@pytest.mark.asyncio
async def test_preflight_excludes_suppressed_recipient(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _superuser(db_session)
    db_session.add(
        EmailSuppression(
            email="blocked@example.org",
            reason="bounce",
            source="test",
            suppressed_at=datetime.now(UTC),
        )
    )
    await db_session.flush()
    _override_user(user)

    response = await client.post(
        "/email/preflight",
        json={
            "recipient_variables": [
                {"email": "blocked@example.org", "name": "退信者", "variables": {}},
                {"email": "ok@example.org", "name": "正常", "variables": {}},
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["unique_count"] == 1
    assert response.json()["suppressed_emails"] == ["blocked@example.org"]


@pytest.mark.asyncio
async def test_resend_event_is_idempotent_and_updates_analytics(
    db_session: AsyncSession,
) -> None:
    user = await _superuser(db_session)
    message = EmailMessage(
        sender_id=user.id,
        subject="追蹤測試",
        body="內容",
        recipient_count=1,
        status="sent",
    )
    db_session.add(message)
    await db_session.flush()
    recipient = EmailCampaignRecipient(
        message_id=message.id,
        email="tracked@example.org",
        provider_id="provider-1",
        status="sent",
    )
    db_session.add(recipient)
    await db_session.flush()
    payload = {
        "id": "event-1",
        "type": "email.opened",
        "data": {"email_id": "provider-1"},
    }

    assert await platform_svc.process_resend_event(db_session, payload) is True
    assert await platform_svc.process_resend_event(db_session, payload) is False
    analytics = await platform_svc.get_analytics(db_session, message.id)
    assert analytics["opened"] == 1
    assert analytics["open_rate_estimated"] == 1
