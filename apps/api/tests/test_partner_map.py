"""特約地圖 API 測試。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies.auth import get_current_active_user, get_optional_user
from api.main import app
from api.models.partner_map import (
    PartnerBusiness,
    PartnerBusinessListingType,
    PartnerBusinessStatus,
    PartnerLocation,
    PartnerOffer,
    PartnerTag,
)
from api.models.user import User
from api.services import partner_map as partner_map_service

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
        member_note="登入學生可見的補充提醒",
        starts_at=datetime.now(UTC) - timedelta(days=1),
        ends_at=datetime.now(UTC) + timedelta(days=7),
    )
    db.add_all([location, offer])
    await db.flush()
    await db.refresh(business)
    return user, business, tag


@pytest.mark.asyncio
async def test_public_partner_map_shows_full_offer_terms(
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
    assert offer["full_description"] == "全品項九折"
    assert offer["instructions"] == "結帳前出示學生證"
    assert offer["member_note"] is None


@pytest.mark.asyncio
async def test_logged_in_partner_map_keeps_member_note_private_to_visitors(
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
    assert payload["offers"][0]["member_note"] == "登入學生可見的補充提醒"


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
async def test_contact_business_is_directory_only_and_exposes_contact_methods(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    business = PartnerBusiness(
        name="自治服飾合作廠商",
        summary="校服與社團服合作窗口",
        status=PartnerBusinessStatus.ACTIVE.value,
        listing_type=PartnerBusinessListingType.ONLINE.value,
        contact_name="合作窗口",
        contact_phone="0912-345-678",
        contact_email="partner@example.com",
        instagram_handle="@campuswear",
        line_id="campuswear",
        other_contact="可預約看樣，請先私訊。",
    )
    db_session.add(business)
    await db_session.flush()
    db_session.add(
        PartnerOffer(
            business_id=business.id,
            title="學生證折扣",
            public_summary="出示學生證享 9 折",
            full_description="全品項 9 折，部分商品除外。",
            instructions="聯絡時出示學生證。",
            starts_at=datetime.now(UTC) - timedelta(days=1),
            ends_at=datetime.now(UTC) + timedelta(days=7),
        )
    )
    await db_session.flush()

    map_response = await client.get("/partner-map", headers=HOST_HEADERS)
    directory_response = await client.get("/partner-map/directory", headers=HOST_HEADERS)
    detail_response = await client.get(
        f"/partner-map/businesses/{business.id}", headers=HOST_HEADERS
    )

    assert map_response.status_code == 200
    assert all(item["business_id"] != str(business.id) for item in map_response.json())
    assert directory_response.status_code == 200
    assert directory_response.json()[0]["listing_type"] == "online"
    assert directory_response.json()[0]["instagram_handle"] == "@campuswear"
    assert directory_response.json()[0]["active_offer_count"] == 1
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["locations"] == []
    assert detail["line_id"] == "campuswear"
    assert detail["other_contact"] == "可預約看樣，請先私訊。"
    assert detail["offers"][0]["public_summary"] == "出示學生證享 9 折"
    assert detail["offers"][0]["full_description"] == "全品項 9 折，部分商品除外。"


@pytest.mark.asyncio
async def test_discovery_lists_physical_and_online_partners(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    _, physical, _ = await _seed_partner_map(db_session)
    online = PartnerBusiness(
        name="班服合作商",
        status=PartnerBusinessStatus.ACTIVE.value,
        listing_type=PartnerBusinessListingType.ONLINE.value,
    )
    db_session.add(online)
    await db_session.flush()

    response = await client.get("/partner-map/discover", headers=HOST_HEADERS)
    physical_response = await client.get(
        "/partner-map/discover", params={"listing_type": "physical"}, headers=HOST_HEADERS
    )

    assert response.status_code == 200
    assert {item["id"] for item in response.json()} == {str(physical.id), str(online.id)}
    assert physical_response.status_code == 200
    assert [item["id"] for item in physical_response.json()] == [str(physical.id)]
    assert physical_response.json()[0]["featured_offer_benefit_type"] == "other"


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
async def test_renaming_partner_tag_updates_business_category(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin = User(
        email="rename-admin@school.edu",
        display_name="分類管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    tag = PartnerTag(name="舊分類")
    business = PartnerBusiness(
        name="分類店家",
        category="舊分類",
        status=PartnerBusinessStatus.ACTIVE.value,
    )
    db_session.add_all([admin, tag, business])
    await db_session.flush()
    _override_current_user(admin)

    response = await client.patch(
        f"/partner-map/admin/tags/{tag.id}",
        json={"name": "新分類"},
        headers=HOST_HEADERS,
    )

    await db_session.refresh(business)
    assert response.status_code == 200
    assert business.category == "新分類"


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
            "initial_offers": [
                {
                    "title": "學生用品折扣",
                    "benefit_type": "discount",
                    "benefit_value": "全館 9 折",
                    "instructions": "結帳前出示學生證。",
                },
                {
                    "title": "滿額贈品",
                    "benefit_type": "gift",
                    "benefit_value": "滿 500 元送飲料",
                },
            ],
            "initial_locations": [
                {
                    "name": "文具店本店",
                    "address": "新竹市東區光復路一段 2 號",
                    "latitude": 24.807,
                    "longitude": 120.969,
                    "google_maps_url": "https://www.google.com/maps/place/station/@24.807,120.969,17z",
                }
            ],
        },
        headers=HOST_HEADERS,
    )

    assert tag_response.status_code == 201
    assert response.status_code == 201
    payload = response.json()
    assert payload["name"] == "自治文具"
    assert payload["tags"][0]["name"] == "文具"
    assert payload["offers"][0]["benefit_value"] == "全館 9 折"
    assert len(payload["offers"]) == 2
    assert payload["locations"][0]["google_maps_url"].endswith("17z")


@pytest.mark.asyncio
async def test_admin_can_parse_google_maps_link(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin = User(
        email="maps-admin@school.edu",
        display_name="地圖管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    db_session.add(admin)
    await db_session.flush()
    _override_current_user(admin)

    response = await client.post(
        "/partner-map/admin/locations/parse-google-maps",
        json={"url": "https://www.google.com/maps/search/?api=1&query=24.806,120.968"},
        headers=HOST_HEADERS,
    )

    assert response.status_code == 200
    assert response.json()["latitude"] == 24.806
    assert response.json()["longitude"] == 120.968


@pytest.mark.asyncio
async def test_google_maps_short_link_rejects_redirect_to_untrusted_host(monkeypatch):
    class FakeResponse:
        is_redirect = True
        headers = {"location": "https://127.0.0.1/internal"}

        def raise_for_status(self):
            raise AssertionError("untrusted redirect should be rejected before follow-up")

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url):
            assert url == "https://goo.gl/maps/example"
            return FakeResponse()

    monkeypatch.setattr(partner_map_service.httpx, "AsyncClient", lambda **kwargs: FakeClient())

    with pytest.raises(ValueError, match="無法展開"):
        await partner_map_service.parse_google_maps_link("https://goo.gl/maps/example")


@pytest.mark.asyncio
async def test_google_maps_link_rejects_userinfo_host_confusion():
    with pytest.raises(ValueError, match="Google Maps"):
        await partner_map_service.parse_google_maps_link("https://goo.gl@127.0.0.1/maps/example")


@pytest.mark.asyncio
async def test_google_maps_place_name_is_not_saved_as_address(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin = User(
        email="maps-place-admin@school.edu",
        display_name="地圖管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    db_session.add(admin)
    await db_session.flush()
    _override_current_user(admin)

    response = await client.post(
        "/partner-map/admin/locations/parse-google-maps",
        json={
            "url": "https://www.google.com/maps/place/古比鮮釀餐廳+竹北店/@24.8440999,121.0220416,17z"
        },
        headers=HOST_HEADERS,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "古比鮮釀餐廳 竹北店"
    assert payload["address"] is None
    assert payload["latitude"] == 24.8440999
    assert payload["longitude"] == 121.0220416


@pytest.mark.asyncio
async def test_google_maps_parser_prefers_place_coordinates_over_viewport_center(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin = User(
        email="maps-place-coordinate-admin@school.edu",
        display_name="地圖管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    db_session.add(admin)
    await db_session.flush()
    _override_current_user(admin)

    response = await client.post(
        "/partner-map/admin/locations/parse-google-maps",
        json={
            "url": (
                "https://www.google.com/maps/place/統帥西服/@24.795151,120.98018,16z/"
                "data=!3d24.801234!4d120.974567"
            )
        },
        headers=HOST_HEADERS,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["latitude"] == 24.801234
    assert payload["longitude"] == 120.974567


@pytest.mark.asyncio
async def test_admin_rejects_non_google_maps_link(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    admin = User(
        email="maps-admin-invalid@school.edu",
        display_name="地圖管理員",
        is_active=True,
        is_verified=True,
        is_superuser=True,
    )
    db_session.add(admin)
    await db_session.flush()
    _override_current_user(admin)

    response = await client.post(
        "/partner-map/admin/locations/parse-google-maps",
        json={"url": "https://example.com/store"},
        headers=HOST_HEADERS,
    )

    assert response.status_code == 422
