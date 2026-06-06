"""特約地圖 API 測試。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.main import app
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.models.partner_map import (
    PartnerBusiness,
    PartnerBusinessStatus,
    PartnerLocation,
    PartnerOffer,
    PartnerTag,
)
from api.models.user import User

HOST_HEADERS = {"host": "localhost"}


def _override_current_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


def _override_optional_user(user: User | None) -> None:
    async def override() -> User | None:
        return user

    app.dependency_overrides[get_optional_user] = override


async def _seed_partner_map(db: AsyncSession) -> tuple[User, PartnerBusiness, PartnerTag]:
    user = User(
        email="student@school.edu",
        display_name="學生",
        is_active=True,
        is_verified=True,
    )
    tag = PartnerTag(name="餐飲", color="#10B981", sort_order=1)
    business = PartnerBusiness(
        name="自治咖啡",
        summary="學生會特約咖啡店",
        description="校園附近咖啡店",
        status=PartnerBusinessStatus.ACTIVE.value,
    )
    business.tags = [tag]
    db.add_all([user, tag, business])
    await db.flush()

    location = PartnerLocation(
        business_id=business.id,
        address="新竹市東區光復路一段 1 號",
        latitude=24.806,
        longitude=120.968,
        phone="03-1234567",
        business_hours={},
    )
    offer = PartnerOffer(
        business_id=business.id,
        title="學生證九折",
        public_summary="出示學生證享折扣",
        full_description="全品項九折",
        instructions="結帳前出示學生證",
        starts_at=datetime.now(UTC) - timedelta(days=1),
        ends_at=datetime.now(UTC) + timedelta(days=7),
    )
    db.add_all([location, offer])
    await db.flush()
    await db.refresh(business)
    return user, business, tag


@pytest.mark.asyncio
async def test_public_partner_map_hides_private_offer_details(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    _, business, _ = await _seed_partner_map(db_session)

    list_response = await client.get("/partner-map", headers=HOST_HEADERS)
    detail_response = await client.get(
        f"/partner-map/businesses/{business.id}", headers=HOST_HEADERS
    )

    assert list_response.status_code == 200
    assert list_response.json()[0]["phone"] is None
    assert detail_response.status_code == 200
    offer = detail_response.json()["offers"][0]
    assert offer["public_summary"] == "出示學生證享折扣"
    assert offer["full_description"] is None
    assert offer["instructions"] is None


@pytest.mark.asyncio
async def test_logged_in_partner_map_shows_private_offer_details(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user, business, _ = await _seed_partner_map(db_session)
    _override_optional_user(user)

    list_response = await client.get("/partner-map", headers=HOST_HEADERS)
    detail_response = await client.get(
        f"/partner-map/businesses/{business.id}", headers=HOST_HEADERS
    )

    assert list_response.status_code == 200
    assert list_response.json()[0]["phone"] == "03-1234567"
    assert detail_response.status_code == 200
    payload = detail_response.json()
    assert payload["can_view_private_details"] is True
    assert payload["offers"][0]["full_description"] == "全品項九折"
    assert payload["offers"][0]["instructions"] == "結帳前出示學生證"


@pytest.mark.asyncio
async def test_partner_map_filters_by_keyword_tag_bounds_and_offer(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    _, _, tag = await _seed_partner_map(db_session)

    response = await client.get(
        "/partner-map",
        params={
            "keyword": "咖啡",
            "tag_ids": str(tag.id),
            "min_lat": "24.8",
            "max_lat": "24.9",
            "min_lng": "120.9",
            "max_lng": "121.0",
            "has_active_offer": "true",
        },
        headers=HOST_HEADERS,
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["business_name"] == "自治咖啡"


@pytest.mark.asyncio
async def test_partner_map_admin_requires_permission(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    user = User(
        email="member@school.edu", display_name="一般成員", is_active=True, is_verified=True
    )
    db_session.add(user)
    await db_session.flush()
    _override_current_user(user)

    response = await client.post(
        "/partner-map/admin/tags", json={"name": "飲料"}, headers=HOST_HEADERS
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_partner_map_admin_can_create_business(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin = User(
        email="admin@school.edu",
        display_name="管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    db_session.add(admin)
    await db_session.flush()
    _override_current_user(admin)

    tag_response = await client.post(
        "/partner-map/admin/tags", json={"name": "文具"}, headers=HOST_HEADERS
    )
    response = await client.post(
        "/partner-map/admin/businesses",
        json={
            "name": "自治文具",
            "summary": "議會合作文具店",
            "status": "active",
            "tag_ids": [tag_response.json()["id"]],
        },
        headers=HOST_HEADERS,
    )

    assert tag_response.status_code == 201
    assert response.status_code == 201
    payload = response.json()
    assert payload["name"] == "自治文具"
    assert payload["tags"][0]["name"] == "文具"
