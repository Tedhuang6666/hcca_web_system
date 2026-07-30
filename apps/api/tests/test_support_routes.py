"""客服作業平台路由與權限邊界測試。"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.user import User
from api.services.support import (
    create_support_impersonation_token,
    mask_email,
    mask_identifier,
    mask_name,
    user_summary,
)


@pytest.mark.asyncio
async def test_support_superuser_user_search_returns_full_personal_data(
    client: AsyncClient,
    admin_user,
    make_user,
) -> None:
    target = await make_user(
        email="student-number-1234@school.edu",
        display_name="王小明",
        student_id="B12345678",
    )

    async def override_admin():
        return admin_user

    app.dependency_overrides[get_current_active_user] = override_admin
    response = await client.get("/support/users", params={"query": "student-number-1234"})

    assert response.status_code == 200, response.text
    item = next(row for row in response.json() if row["id"] == str(target.id))
    assert item["display_name"] == target.display_name
    assert item["email"] == target.email
    assert item["student_id"] == target.student_id
    assert item["masked_email"] == mask_email(target.email)


def test_support_user_summary_masks_without_sensitive_access() -> None:
    user = User(
        email="student-number-1234@school.edu",
        display_name="王小明",
        student_id="B12345678",
    )

    summary = user_summary(user)

    assert summary["display_name"] == mask_name(user.display_name)
    assert summary["email"] == mask_email(user.email)
    assert summary["student_id"] == mask_identifier(user.student_id, visible_end=2)


@pytest.mark.asyncio
async def test_support_routes_reject_user_without_support_permission(
    client: AsyncClient,
    member_user,
) -> None:
    async def override_member():
        return member_user

    app.dependency_overrides[get_current_active_user] = override_member
    response = await client.get("/support/users")

    assert response.status_code == 403


def test_support_masking_handles_short_values() -> None:
    assert mask_name("王") == "○"
    assert mask_email("a@example.com") == "a**@example.com"
    assert mask_identifier("12", visible_end=2) == "**"


@pytest.mark.asyncio
async def test_read_only_impersonation_blocks_write_before_route_validation(
    client: AsyncClient,
    make_user,
) -> None:
    actor = await make_user(is_superuser=True, email="support-admin@school.edu")
    target = await make_user(email="target@school.edu")
    token, _ = create_support_impersonation_token(actor, target, minutes=15, read_only=True)

    response = await client.post(
        f"/support/users/{target.id}/actions/unlock",
        headers={"Authorization": f"Bearer {token}"},
        json={},
    )

    assert response.status_code == 403
    assert "唯讀" in response.json()["detail"]


@pytest.mark.asyncio
async def test_interactive_impersonation_blocks_sensitive_areas(
    client: AsyncClient,
    make_user,
) -> None:
    actor = await make_user(is_superuser=True, email="support-admin-2@school.edu")
    target = await make_user(email="target-2@school.edu")
    token, _ = create_support_impersonation_token(actor, target, minutes=15, read_only=False)

    response = await client.get(
        "/finance/overview",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    assert "不允許進入" in response.json()["detail"]
