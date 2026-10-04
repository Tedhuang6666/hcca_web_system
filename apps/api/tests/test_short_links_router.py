"""班聯短網址的權限、管理與公開解析測試。"""

from __future__ import annotations

import uuid
from datetime import timedelta


async def _grant_short_link_manage(db_session, user) -> None:
    from api.core.clock import local_today
    from api.models.org import Org, Permission, Position, UserPosition

    org = Org(name=f"short-links-org-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="經營工具管理員")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code="qr_code:manage"))
    db_session.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=local_today() - timedelta(days=1),
            end_date=None,
        )
    )
    await db_session.flush()


def _payload(**overrides) -> dict[str, str]:
    payload = {
        "slug": "學生社群",
        "title": "學生社群",
        "target_url": "https://example.edu/student-community",
    }
    payload.update(overrides)
    return payload


async def test_short_link_management_requires_login_and_permission(
    client, member_user, authed_client_factory
) -> None:
    client.cookies.clear()
    anonymous = await client.get("/short-links")
    assert anonymous.status_code == 401

    manager_client = authed_client_factory(member_user)
    forbidden = await manager_client.get("/short-links")
    assert forbidden.status_code == 403


async def test_short_link_create_update_disable_and_public_resolve(
    db_session, client, member_user, authed_client_factory
) -> None:
    await _grant_short_link_manage(db_session, member_user)
    manager_client = authed_client_factory(member_user)

    created = await manager_client.post("/short-links", json=_payload())
    assert created.status_code == 201
    short_link = created.json()
    assert short_link["slug"] == "學生社群"
    assert short_link["is_active"] is True

    duplicate = await manager_client.post("/short-links", json=_payload())
    assert duplicate.status_code == 409

    client.cookies.clear()
    resolved = await client.get("/short-links/resolve/學生社群")
    assert resolved.status_code == 200
    assert resolved.json()["target_url"] == "https://example.edu/student-community"

    updated = await manager_client.patch(
        f"/short-links/{short_link['id']}",
        json={"title": "學生社群入口", "target_url": "https://example.edu/community"},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "學生社群入口"
    assert updated.json()["target_url"] == "https://example.edu/community"

    paused = await manager_client.patch(
        f"/short-links/{short_link['id']}", json={"is_active": False}
    )
    assert paused.status_code == 200
    assert paused.json()["is_active"] is False

    unavailable = await client.get("/short-links/resolve/學生社群")
    assert unavailable.status_code == 404

    listing = await manager_client.get("/short-links")
    assert listing.status_code == 200
    assert listing.json()[0]["slug"] == "學生社群"


async def test_short_link_rejects_reserved_slug_and_unsafe_url(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant_short_link_manage(db_session, member_user)
    manager_client = authed_client_factory(member_user)

    reserved = await manager_client.post("/short-links", json=_payload(slug="login"))
    assert reserved.status_code == 409

    document_route = await manager_client.post(
        "/short-links", json=_payload(slug="嶺代議字1150000001號")
    )
    assert document_route.status_code == 409

    unsafe_url = await manager_client.post(
        "/short-links", json=_payload(slug="unsafe", target_url="javascript:alert(1)")
    )
    assert unsafe_url.status_code == 422
