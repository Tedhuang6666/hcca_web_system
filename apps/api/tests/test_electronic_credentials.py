"""電子證件特殊身分授權 API 測試。"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.electronic_credential import (
    ElectronicCredentialAuthorization,
    ElectronicCredentialSettings,
)
from api.models.user import User
from api.services.electronic_credential import identity_for_user


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


@pytest.mark.asyncio
async def test_admin_can_configure_student_id_prefixes(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_user: User,
) -> None:
    async def override_current_user() -> User:
        return admin_user

    app.dependency_overrides[get_current_active_user] = override_current_user
    initial = await client.get("/electronic-credentials/admin/settings")
    assert initial.status_code == 200
    assert initial.json() == {"student_id_prefixes": ["310", "410", "510"]}

    response = await client.patch(
        "/electronic-credentials/admin/settings",
        json={"student_id_prefixes": ["410", "710"]},
    )
    assert response.status_code == 200
    assert response.json() == {"student_id_prefixes": ["410", "710"]}

    invalid = await client.patch(
        "/electronic-credentials/admin/settings", json={"student_id_prefixes": ["41"]}
    )
    assert invalid.status_code == 422
    duplicate = await client.patch(
        "/electronic-credentials/admin/settings",
        json={"student_id_prefixes": ["410", "410"]},
    )
    assert duplicate.status_code == 422
    current = await client.get("/electronic-credentials/admin/settings")
    assert current.json() == {"student_id_prefixes": ["410", "710"]}


@pytest.mark.asyncio
async def test_student_credential_settings_requires_manager(
    client: AsyncClient,
    member_user: User,
) -> None:
    async def override_current_user() -> User:
        return member_user

    app.dependency_overrides[get_current_active_user] = override_current_user
    response = await client.patch(
        "/electronic-credentials/admin/settings",
        json={"student_id_prefixes": ["310", "410", "510"]},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("student_id", ["310123", "410123", "510123"])
async def test_student_credential_requires_matching_school_email_and_student_id(
    client: AsyncClient,
    db_session: AsyncSession,
    member_user: User,
    monkeypatch: pytest.MonkeyPatch,
    student_id: str,
) -> None:
    member_user.email = f"g0{student_id}@hchs.hc.edu.tw"
    member_user.student_id = student_id
    monkeypatch.setattr(settings, "LOGIN_ALLOWED_EMAIL_DOMAINS", ["hchs.hc.edu.tw"])
    db_session.add(ElectronicCredentialSettings(id=1, student_id_prefixes=["310", "410", "510"]))
    await db_session.flush()

    async def override_current_user() -> User:
        return member_user

    app.dependency_overrides[get_current_active_user] = override_current_user
    response = await client.get("/electronic-credentials/me")

    assert response.status_code == 200
    assert response.json()["identity_kind"] == "student"
    assert response.json()["student_id"] == student_id


@pytest.mark.asyncio
async def test_student_credential_rejects_other_prefix_and_mismatched_student_id(
    client: AsyncClient,
    db_session: AsyncSession,
    member_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "LOGIN_ALLOWED_EMAIL_DOMAINS", ["hchs.hc.edu.tw"])
    db_session.add(ElectronicCredentialSettings(id=1, student_id_prefixes=["310", "410", "510"]))
    await db_session.flush()

    async def override_current_user() -> User:
        return member_user

    app.dependency_overrides[get_current_active_user] = override_current_user

    member_user.email = "g0610123@hchs.hc.edu.tw"
    member_user.student_id = "610123"
    other_cohort_response = await client.get("/electronic-credentials/me")
    assert other_cohort_response.status_code == 403

    member_user.email = "g0410123@hchs.hc.edu.tw"
    member_user.student_id = "310456"
    mismatched_id_response = await client.get("/electronic-credentials/me")
    assert mismatched_id_response.status_code == 403


@pytest.mark.asyncio
async def test_teacher_credential_does_not_require_student_id_prefix(
    client: AsyncClient,
    db_session: AsyncSession,
    member_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    member_user.email = "teacher@hchs.hc.edu.tw"
    member_user.student_id = None
    monkeypatch.setattr(settings, "LOGIN_ALLOWED_EMAIL_DOMAINS", ["hchs.hc.edu.tw"])
    db_session.add(ElectronicCredentialSettings(id=1, student_id_prefixes=[]))
    await db_session.flush()

    async def override_current_user() -> User:
        return member_user

    app.dependency_overrides[get_current_active_user] = override_current_user
    response = await client.get("/electronic-credentials/me")

    assert response.status_code == 200
    assert response.json()["identity_kind"] == "teacher"


@pytest.mark.asyncio
async def test_special_authorization_does_not_require_student_id_prefix(
    client: AsyncClient,
    db_session: AsyncSession,
    member_user: User,
) -> None:
    db_session.add(
        ElectronicCredentialAuthorization(
            email=member_user.email,
            identity_label="活動協力人員",
        )
    )
    await db_session.flush()

    async def override_current_user() -> User:
        return member_user

    app.dependency_overrides[get_current_active_user] = override_current_user
    response = await client.get("/electronic-credentials/me")

    assert response.status_code == 200
    assert response.json()["identity_kind"] == "authorized"


def test_student_identity_requires_matching_prefix_email_and_student_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "LOGIN_ALLOWED_EMAIL_DOMAINS", ["hchs.hc.edu.tw"])
    matching_user = User(
        email="g0410123@hchs.hc.edu.tw",
        display_name="測試學生",
        student_id="410123",
    )
    other_cohort = User(
        email="g0610123@hchs.hc.edu.tw",
        display_name="其他屆學生",
        student_id="610123",
    )
    mismatched_student_id = User(
        email="g0410123@hchs.hc.edu.tw",
        display_name="學號不一致",
        student_id="310456",
    )
    malformed_student_id = User(
        email="g0410abc@hchs.hc.edu.tw",
        display_name="學號格式錯誤",
        student_id="410abc",
    )

    allowed_prefixes = ["310", "410", "510"]
    assert identity_for_user(matching_user, student_id_prefixes=allowed_prefixes) == (
        "student",
        "校內學生",
    )
    assert identity_for_user(other_cohort, student_id_prefixes=allowed_prefixes) is None
    assert identity_for_user(mismatched_student_id, student_id_prefixes=allowed_prefixes) is None
    assert identity_for_user(malformed_student_id, student_id_prefixes=allowed_prefixes) is None
    assert identity_for_user(matching_user) is None
