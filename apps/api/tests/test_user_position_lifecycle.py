"""兩個任期管理入口共用完整生命週期，登入歸屬同步則保持可重入。"""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from api.core.cache import cache_get, cache_set
from api.core.clock import local_today
from api.models.org import Org, Permission, Position, UserPosition
from api.models.person import (
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationStatus,
)
from api.services import person as person_svc
from api.services import user_session
from api.services.permission import get_user_permission_codes


async def _position(db):
    org = Org(name="任期生命週期測試")
    db.add(org)
    await db.flush()
    position = Position(org_id=org.id, name="財務幹部")
    db.add(position)
    await db.flush()
    db.add(Permission(position_id=position.id, code="finance:view"))
    await db.flush()
    return org, position


async def _active_session(db, user):
    pair = await user_session.issue_session_tokens(
        db,
        user_id=user.id,
        extra_claims=None,
        user_agent="tenure-test",
        ip_address="127.0.0.1",
        auth_method="oauth",
    )
    return pair.session


@pytest.mark.parametrize("create_route,edit_route", [("admin", "term"), ("term", "admin")])
async def test_both_tenure_entries_mirror_dates_revoke_sessions_and_clear_cached_access(
    db_session,
    admin_user,
    member_user,
    authed_client_factory,
    monkeypatch,
    create_route,
    edit_route,
):
    _, position = await _position(db_session)
    actor = authed_client_factory(admin_user)
    role_sync = AsyncMock()
    monkeypatch.setattr("api.services.user_position.enqueue_role_sync", role_sync)
    assert "finance:view" not in await get_user_permission_codes(db_session, member_user.id)
    active_session = await _active_session(db_session, member_user)
    start = local_today() - timedelta(days=10)
    create_path = (
        f"/admin/users/{member_user.id}/positions" if create_route == "admin" else "/user-positions"
    )
    body = {"position_id": str(position.id), "start_date": start.isoformat()}
    if create_route == "term":
        body["user_id"] = str(member_user.id)
    created = await actor.post(create_path, json=body)
    assert created.status_code == 201, created.text
    up = await db_session.scalar(select(UserPosition).where(UserPosition.user_id == member_user.id))
    assert up is not None
    affiliation = await db_session.scalar(
        select(PersonAffiliation).where(PersonAffiliation.synced_user_position_id == up.id)
    )
    assert affiliation is not None
    assert affiliation.start_date == up.start_date == start
    assert affiliation.end_date is None
    await db_session.refresh(active_session)
    assert active_session.revoked_reason == "permission_changed"
    assert "finance:view" in await get_user_permission_codes(db_session, member_user.id)
    role_sync.assert_awaited_once_with(db_session, member_user.id)
    edit_path = (
        f"/admin/users/{member_user.id}/positions/{up.id}"
        if edit_route == "admin"
        else f"/user-positions/{up.id}"
    )
    active_session = await _active_session(db_session, member_user)
    await cache_set(f"dashboard:{member_user.id}", {"stale": True}, ttl=60)
    expired_on = local_today() - timedelta(days=1)
    ended = await actor.patch(edit_path, json={"end_date": expired_on.isoformat()})
    assert ended.status_code == 200, ended.text
    await db_session.refresh(affiliation)
    await db_session.refresh(active_session)
    assert affiliation.end_date == expired_on
    assert affiliation.status == PersonAffiliationStatus.ENDED
    assert active_session.revoked_at is not None
    assert "finance:view" not in await get_user_permission_codes(db_session, member_user.id)
    assert await cache_get(f"dashboard:{member_user.id}") is None

    active_session = await _active_session(db_session, member_user)
    reopened = await actor.patch(edit_path, json={"end_date": None})
    assert reopened.status_code == 200, reopened.text
    await db_session.refresh(affiliation)
    await db_session.refresh(active_session)
    assert affiliation.start_date == start
    assert affiliation.end_date is None
    assert affiliation.status == PersonAffiliationStatus.ACTIVE
    assert active_session.revoked_at is not None
    assert "finance:view" in await get_user_permission_codes(db_session, member_user.id)

    active_session = await _active_session(db_session, member_user)
    deleted = await actor.delete(edit_path)
    assert deleted.status_code == 204, deleted.text
    assert await db_session.get(UserPosition, up.id) is None
    await db_session.refresh(affiliation)
    await db_session.refresh(active_session)
    assert affiliation.status == PersonAffiliationStatus.ENDED
    assert affiliation.synced_user_position_id is None
    assert active_session.revoked_at is not None
    assert "finance:view" not in await get_user_permission_codes(db_session, member_user.id)
    assert role_sync.await_count == 4
    assert await person_svc.sync_affiliation_to_rbac(db_session, affiliation) is None


@pytest.mark.parametrize("route", ["admin", "term"])
async def test_tenure_entries_preserve_authorization_scope_and_reject_invalid_dates(
    db_session, admin_user, member_user, client, authed_client_factory, route
):
    org, position = await _position(db_session)
    actor = authed_client_factory(admin_user)
    path = f"/admin/users/{member_user.id}/positions" if route == "admin" else "/user-positions"
    body = {
        "position_id": str(position.id),
        "start_date": local_today().isoformat(),
        **({"user_id": str(member_user.id)} if route == "term" else {}),
    }
    assert (await client.post(path, json=body)).status_code == 401
    assert (await authed_client_factory(member_user).post(path, json=body)).status_code == 403
    invalid = await actor.post(
        path, json={**body, "end_date": (local_today() - timedelta(days=1)).isoformat()}
    )
    assert invalid.status_code == 422
    org.is_active = False
    await db_session.flush()
    assert (await actor.post(path, json=body)).status_code == 409
    org.is_active = True
    await db_session.flush()
    created = await actor.post(path, json=body)
    assert created.status_code == 201, created.text
    up = await db_session.scalar(select(UserPosition).where(UserPosition.user_id == member_user.id))
    assert up is not None
    wrong_scope = f"/admin/users/{admin_user.id}/positions/{up.id}"
    assert (await actor.patch(wrong_scope, json={"end_date": None})).status_code == 404
    assert (await actor.delete(wrong_scope)).status_code == 404


async def test_reconciliation_preserves_sessions_and_does_not_repeat_role_sync(
    db_session, member_user, monkeypatch
):
    org, position = await _position(db_session)
    person = Person(user_id=member_user.id, display_name=member_user.display_name)
    db_session.add(person)
    await db_session.flush()
    affiliation = PersonAffiliation(
        person_id=person.id,
        kind=PersonAffiliationKind.ORG_POSITION,
        org_id=org.id,
        position_id=position.id,
        start_date=local_today(),
        status=PersonAffiliationStatus.ACTIVE,
    )
    db_session.add(affiliation)
    await db_session.flush()
    active_session = await _active_session(db_session, member_user)
    role_sync = AsyncMock()
    monkeypatch.setattr("api.services.user_position.enqueue_role_sync", role_sync)
    up = await person_svc.sync_affiliation_to_rbac(db_session, affiliation)
    assert up is not None
    assert await person_svc.sync_affiliation_to_rbac(db_session, affiliation) is up
    role_sync.assert_awaited_once_with(db_session, member_user.id)
    affiliation.end_date = local_today() + timedelta(days=10)
    await person_svc.sync_affiliation_to_rbac(db_session, affiliation)
    assert up.end_date == affiliation.end_date
    assert role_sync.await_count == 2
    await db_session.refresh(active_session)
    assert active_session.revoked_at is None


async def test_separate_terms_keep_distinct_affiliations_and_admin_start_patch_preserves_end(
    db_session, admin_user, member_user, authed_client_factory
):
    _, position = await _position(db_session)
    actor = authed_client_factory(admin_user)
    path = f"/admin/users/{member_user.id}/positions"
    start = local_today()
    end = start + timedelta(days=30)
    for offset in (0, 2):
        response = await actor.post(
            path,
            json={
                "position_id": str(position.id),
                "start_date": (start + timedelta(days=offset)).isoformat(),
                "end_date": end.isoformat(),
            },
        )
        assert response.status_code == 201, response.text
    affiliations = list((await db_session.scalars(select(PersonAffiliation))).all())
    assert len(affiliations) == 2
    assert len({item.synced_user_position_id for item in affiliations}) == 2
    first = next(item for item in affiliations if item.start_date == start)
    response = await actor.patch(
        f"{path}/{first.synced_user_position_id}",
        json={"start_date": (start - timedelta(days=2)).isoformat()},
    )
    assert response.status_code == 200, response.text
    await db_session.refresh(first)
    assert first.start_date == start - timedelta(days=2)
    assert first.end_date == end
    assert first.status == PersonAffiliationStatus.ACTIVE


async def test_assignment_reuses_pending_affiliation_linked_while_claiming_person(
    db_session, admin_user, member_user, authed_client_factory
):
    org, position = await _position(db_session)
    member_user.student_id = "TERMLINK001"
    person = Person(student_id=member_user.student_id, display_name=member_user.display_name)
    db_session.add(person)
    await db_session.flush()
    affiliation = PersonAffiliation(
        person_id=person.id,
        kind=PersonAffiliationKind.ORG_POSITION,
        org_id=org.id,
        position_id=position.id,
        start_date=local_today(),
        status=PersonAffiliationStatus.PENDING_USER,
    )
    db_session.add(affiliation)
    await db_session.flush()
    response = await authed_client_factory(admin_user).post(
        f"/admin/users/{member_user.id}/positions",
        json={"position_id": str(position.id), "start_date": local_today().isoformat()},
    )
    assert response.status_code == 201, response.text
    await db_session.refresh(affiliation)
    assert person.user_id == member_user.id
    assert affiliation.status == PersonAffiliationStatus.ACTIVE
    assert affiliation.synced_user_position_id is not None
    assert list((await db_session.scalars(select(PersonAffiliation.id))).all()) == [affiliation.id]
