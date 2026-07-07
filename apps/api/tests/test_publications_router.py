"""發布中心路由測試（apps/api/src/api/routers/publications.py）。"""

from __future__ import annotations

import uuid
from datetime import timedelta


async def _grant(db_session, user, code: str) -> None:
    from api.core.clock import local_today
    from api.models.org import Org, Permission, Position, UserPosition

    org = Org(name=f"pub-org-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="公告發布員")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code=code))
    db_session.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=local_today() - timedelta(days=1),
            end_date=None,
        )
    )
    await db_session.flush()


def _campaign_payload(**overrides) -> dict:
    defaults = {
        "title": "期初宣導",
        "body": "本學期重要事項公告內容。",
        "channels": ["announcement"],
    }
    defaults.update(overrides)
    return defaults


async def test_list_publications_without_permission_returns_403(
    member_user, authed_client_factory
) -> None:
    ac = authed_client_factory(member_user)
    resp = await ac.get("/publications")
    assert resp.status_code == 403


async def test_create_publication_succeeds(db_session, member_user, authed_client_factory) -> None:
    await _grant(db_session, member_user, "announcement:create")
    ac = authed_client_factory(member_user)

    resp = await ac.post("/publications", json=_campaign_payload())

    assert resp.status_code == 201
    assert resp.json()["title"] == "期初宣導"


async def test_get_publication_missing_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "announcement:create")
    ac = authed_client_factory(member_user)

    resp = await ac.get(f"/publications/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_get_and_list_publication_succeeds(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "announcement:create")
    ac = authed_client_factory(member_user)
    created = await ac.post("/publications", json=_campaign_payload())
    campaign_id = created.json()["id"]

    got = await ac.get(f"/publications/{campaign_id}")
    assert got.status_code == 200
    assert got.json()["id"] == campaign_id

    listed = await ac.get("/publications")
    assert listed.status_code == 200
    assert any(row["id"] == campaign_id for row in listed.json())


async def test_update_publication_succeeds(db_session, member_user, authed_client_factory) -> None:
    await _grant(db_session, member_user, "announcement:create")
    ac = authed_client_factory(member_user)
    created = await ac.post("/publications", json=_campaign_payload())
    campaign_id = created.json()["id"]

    resp = await ac.patch(f"/publications/{campaign_id}", json={"title": "期初宣導（修訂）"})

    assert resp.status_code == 200
    assert resp.json()["title"] == "期初宣導（修訂）"


async def test_update_missing_publication_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "announcement:create")
    ac = authed_client_factory(member_user)

    resp = await ac.patch(f"/publications/{uuid.uuid4()}", json={"title": "x"})
    assert resp.status_code == 404


async def test_preview_publication_renders_channels(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "announcement:create")
    ac = authed_client_factory(member_user)
    created = await ac.post("/publications", json=_campaign_payload())
    campaign_id = created.json()["id"]

    resp = await ac.post(f"/publications/{campaign_id}/preview")

    assert resp.status_code == 200
    assert "announcement" in resp.json()["channels"]


async def test_preview_missing_publication_returns_404(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "announcement:create")
    ac = authed_client_factory(member_user)

    resp = await ac.post(f"/publications/{uuid.uuid4()}/preview")
    assert resp.status_code == 404


async def test_send_publication_without_publish_permission_returns_403(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "announcement:create")
    ac = authed_client_factory(member_user)
    created = await ac.post("/publications", json=_campaign_payload())
    campaign_id = created.json()["id"]

    resp = await ac.post(f"/publications/{campaign_id}/send")
    assert resp.status_code == 403


async def test_send_publication_creates_announcement_and_marks_sent(
    db_session, member_user, authed_client_factory
) -> None:
    await _grant(db_session, member_user, "announcement:create")
    await _grant(db_session, member_user, "announcement:publish")
    ac = authed_client_factory(member_user)
    created = await ac.post("/publications", json=_campaign_payload())
    campaign_id = created.json()["id"]

    resp = await ac.post(f"/publications/{campaign_id}/send")

    assert resp.status_code == 200
    assert resp.json()["status"] == "sent"

    stats = await ac.get(f"/publications/{campaign_id}/stats")
    assert stats.status_code == 200
    assert stats.json()["total_deliveries"] == 1
