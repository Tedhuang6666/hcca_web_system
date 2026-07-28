"""電子證件特殊身分授權 API 測試。"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.electronic_credential import ElectronicCredentialAuthorization
from api.models.user import User


@pytest.mark.asyncio
async def test_admin_can_batch_create_authorizations_and_skip_existing_emails(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_user: User,
) -> None:
    existing = ElectronicCredentialAuthorization(
        email="already-authorized@example.com",
        identity_label="既有身分",
    )
    db_session.add(existing)
    await db_session.flush()

    async def override_current_user() -> User:
        return admin_user

    app.dependency_overrides[get_current_active_user] = override_current_user
    response = await client.post(
        "/electronic-credentials/admin/authorizations/bulk",
        json={
            "emails": [
                "new-one@example.com",
                "NEW-ONE@example.com",
                "already-authorized@example.com",
            ],
            "identity_label": "活動協力人員",
            "note": "2026 活動名冊",
        },
    )

    assert response.status_code == 201
    assert response.json() == {
        "created_count": 1,
        "skipped_emails": ["already-authorized@example.com"],
    }

    emails = await db_session.scalars(
        select(ElectronicCredentialAuthorization.email).order_by(
            ElectronicCredentialAuthorization.email
        )
    )
    assert emails.all() == ["already-authorized@example.com", "new-one@example.com"]


@pytest.mark.asyncio
async def test_batch_authorization_requires_partner_map_permission(
    client: AsyncClient,
    member_user: User,
) -> None:
    async def override_current_user() -> User:
        return member_user

    app.dependency_overrides[get_current_active_user] = override_current_user
    response = await client.post(
        "/electronic-credentials/admin/authorizations/bulk",
        json={
            "emails": ["volunteer@example.com"],
            "identity_label": "活動協力人員",
        },
    )

    assert response.status_code == 403
