"""推薦商家 API 測試。"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user
from api.main import app
from api.models.recommended_vendor import RecommendedVendor, RecommendedVendorStatus
from api.models.user import User

HOST_HEADERS = {"host": "localhost"}


def _override_user(user: User) -> None:
    async def override() -> User:
        return user

    app.dependency_overrides[get_current_active_user] = override


@pytest.mark.asyncio
async def test_public_list_only_returns_active_vendors_with_valid_inspection(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    valid = RecommendedVendor(
        name="安心便當",
        summary="通過檢驗的午餐選擇",
        status=RecommendedVendorStatus.ACTIVE.value,
        hygiene_inspection_date=date.today() - timedelta(days=10),
        hygiene_inspection_expires_at=date.today() + timedelta(days=30),
        contact_phone="03-1234567",
    )
    expired = RecommendedVendor(
        name="過期店家",
        status=RecommendedVendorStatus.ACTIVE.value,
        hygiene_inspection_date=date.today() - timedelta(days=90),
        hygiene_inspection_expires_at=date.today() - timedelta(days=1),
    )
    draft = RecommendedVendor(
        name="尚未審核",
        status=RecommendedVendorStatus.DRAFT.value,
        hygiene_inspection_date=date.today(),
    )
    db_session.add_all([valid, expired, draft])
    await db_session.flush()

    response = await client.get("/recommended-vendors", headers=HOST_HEADERS)

    assert response.status_code == 200
    payload = response.json()
    assert [item["name"] for item in payload] == ["安心便當"]
    assert payload[0]["hygiene_verified"] is True
    assert payload[0]["contact_phone"] == "03-1234567"


@pytest.mark.asyncio
async def test_public_detail_hides_inactive_vendor(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    vendor = RecommendedVendor(
        name="暫不上架店家",
        status=RecommendedVendorStatus.HIDDEN.value,
        hygiene_inspection_date=date.today(),
    )
    db_session.add(vendor)
    await db_session.flush()

    response = await client.get(f"/recommended-vendors/{vendor.id}", headers=HOST_HEADERS)

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_admin_requires_recommended_vendor_permission(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = User(email="recommended-member@school.edu", display_name="一般成員", is_active=True)
    db_session.add(user)
    await db_session.flush()
    _override_user(user)

    response = await client.get("/recommended-vendors/admin/vendors", headers=HOST_HEADERS)

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_can_create_vendor_with_optional_product(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    admin = User(
        email="recommended-admin@school.edu",
        display_name="推薦商家管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    db_session.add(admin)
    await db_session.flush()
    _override_user(admin)

    response = await client.post(
        "/recommended-vendors/admin/vendors",
        headers=HOST_HEADERS,
        json={
            "name": "校園麵食",
            "status": "active",
            "address": "新竹市東區大學路 1 號",
            "latitude": 24.795,
            "longitude": 120.98,
            "google_maps_url": "https://maps.google.com/?q=24.795,120.98",
            "hygiene_inspection_date": str(date.today()),
            "products": [{"name": "牛肉麵", "price_text": "NT$120"}],
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["name"] == "校園麵食"
    assert payload["hygiene_verified"] is True
    assert payload["google_maps_url"].startswith("https://maps.google.com")
    assert payload["products"][0]["name"] == "牛肉麵"
