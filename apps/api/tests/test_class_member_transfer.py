"""分班轉出需涵蓋所有來源，並且不能被自動歸班重新加入。"""

import uuid
from collections.abc import Callable

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.person import Person, PersonAffiliation, PersonAffiliationStatus
from api.models.school_class import SchoolClass
from api.models.user import User
from api.schemas.school_class import (
    ClassManualMemberCreate,
    ClassMembershipCreate,
    ClassRoleAssign,
    ClassRosterEntryCreate,
    ClassStudentRangeCreate,
    SchoolClassCreate,
)
from api.services import school_class as svc
from api.services.permission import get_user_permission_codes


async def make_class(db: AsyncSession, creator: User, *, ranged: bool = True) -> SchoolClass:
    return await svc.create_class(
        db,
        data=SchoolClassCreate(
            academic_year=115,
            class_code=uuid.uuid4().hex[:6],
            grade=1,
            ranges=[ClassStudentRangeCreate(student_id_start="510001", student_id_end="510040")]
            if ranged
            else [],
        ),
        created_by=creator.id,
    )


@pytest.mark.parametrize("source", ["range", "roster", "manual", "membership"])
async def test_transfer_removes_all_sources_and_allows_explicit_rejoin(
    db_session: AsyncSession,
    admin_user: User,
    make_user: Callable,
    authed_client_factory: Callable,
    source: str,
) -> None:
    sc = await make_class(db_session, admin_user)
    user = await make_user(email="transfer@example.test", student_id="510007")
    if source == "roster":
        await svc.add_roster_entry(
            db_session, sc, data=ClassRosterEntryCreate(seat_number=7, student_id=user.student_id)
        )
    elif source == "manual":
        await svc.add_manual_member(db_session, sc, data=ClassManualMemberCreate(user_id=user.id))
    elif source == "membership":
        await svc.add_membership(db_session, sc, data=ClassMembershipCreate(user_id=user.id))
    ac = authed_client_factory(admin_user)
    person = await db_session.scalar(select(Person).where(Person.user_id == user.id))
    identity_id = person.id if source == "membership" else user.id
    assert (await ac.delete(f"/classes/{sc.id}/members/{identity_id}")).status_code == 204
    assert (await ac.get(f"/classes/{sc.id}/members")).json() == []
    assert (await ac.get(f"/classes/{sc.id}/roster")).json() == []
    refreshed = await svc.get_class(db_session, sc.id)
    assert not await svc.is_class_member(db_session, refreshed, user)
    assert await svc.resolve_user_class(db_session, user) is None
    assert (await ac.delete(f"/classes/{sc.id}/members/{user.id}")).status_code == 404

    response = await ac.post(f"/classes/{sc.id}/memberships", json={"user_id": str(user.id)})
    assert response.status_code == 201
    assert (await svc.resolve_user_class(db_session, user)).id == sc.id
    assert [row["user_id"] for row in (await ac.get(f"/classes/{sc.id}/members")).json()] == [
        str(user.id)
    ]


async def test_transfer_unregistered_roster_ends_pending_role_and_releases_seat(
    db_session: AsyncSession, admin_user: User, authed_client_factory: Callable
) -> None:
    sc = await make_class(db_session, admin_user)
    ac = authed_client_factory(admin_user)
    entry = (
        await ac.post(f"/classes/{sc.id}/roster", json={"seat_number": 7, "student_id": "510007"})
    ).json()
    response = await ac.post(
        f"/classes/{sc.id}/roles/class_leader/assign-person",
        json={
            "student_id": "510007",
            "display_name": "待註冊同學",
        },
    )
    assert response.status_code == 201
    assert (await ac.delete(f"/classes/{sc.id}/members/{entry['id']}")).status_code == 204
    assert (await ac.get(f"/classes/{sc.id}/members")).json() == []
    roles = (await ac.get(f"/classes/{sc.id}/roles")).json()
    assert all(not role["person_holders"] for role in roles)
    person = await db_session.scalar(select(Person).where(Person.student_id == "510007"))
    affiliations = await db_session.scalars(
        select(PersonAffiliation).where(
            PersonAffiliation.person_id == person.id,
            PersonAffiliation.class_id == sc.id,
        )
    )
    assert all(item.status == PersonAffiliationStatus.ENDED for item in affiliations)
    assert (
        await ac.post(
            f"/classes/{sc.id}/roster",
            json={
                "seat_number": 7,
                "student_id": "510008",
            },
        )
    ).status_code == 201


async def test_transfer_revokes_class_role_immediately_and_preserves_other_class(
    db_session: AsyncSession,
    admin_user: User,
    make_user: Callable,
    authed_client_factory: Callable,
) -> None:
    sc = await make_class(db_session, admin_user)
    other = await make_class(db_session, admin_user, ranged=False)
    user = await make_user(email="leader@example.test", student_id="510007")
    await svc.assign_class_role(
        db_session, sc, role_key="class_leader", data=ClassRoleAssign(user_id=user.id)
    )
    await svc.add_membership(db_session, other, data=ClassMembershipCreate(user_id=user.id))
    assert "class:view_members" in await get_user_permission_codes(db_session, user.id)
    ac = authed_client_factory(admin_user)
    assert (await ac.delete(f"/classes/{sc.id}/members/{user.id}")).status_code == 204
    assert "class:view_members" not in await get_user_permission_codes(db_session, user.id)
    assert all(not role["holders"] for role in (await ac.get(f"/classes/{sc.id}/roles")).json())
    assert (await svc.resolve_user_class(db_session, user)).id == other.id


async def test_transfer_rejects_unauthenticated_unprivileged_and_foreign_roster(
    db_session: AsyncSession,
    admin_user: User,
    member_user: User,
    client: AsyncClient,
    authed_client_factory: Callable,
) -> None:
    sc = await make_class(db_session, admin_user)
    other = await make_class(db_session, admin_user, ranged=False)
    entry = await svc.add_roster_entry(
        db_session, sc, data=ClassRosterEntryCreate(seat_number=7, student_id="510007")
    )
    path = f"/classes/{sc.id}/members/{entry.id}"
    assert (await client.delete(path)).status_code == 401
    assert (await authed_client_factory(member_user).delete(path)).status_code == 403
    ac = authed_client_factory(admin_user)
    assert (await ac.delete(f"/classes/{other.id}/members/{entry.id}")).status_code == 404
    assert len((await ac.get(f"/classes/{sc.id}/roster")).json()) == 1


async def test_transfer_old_roster_after_manual_reassignment_preserves_current_class(
    db_session: AsyncSession,
    admin_user: User,
    make_user: Callable,
    authed_client_factory: Callable,
) -> None:
    sc = await make_class(db_session, admin_user)
    other = await make_class(db_session, admin_user, ranged=False)
    user = await make_user(email="reassigned@example.test", student_id="510007")
    entry = await svc.add_roster_entry(
        db_session, sc, data=ClassRosterEntryCreate(seat_number=7, student_id="510007")
    )
    await svc.assign_class_role(
        db_session, sc, role_key="class_leader", data=ClassRoleAssign(user_id=user.id)
    )
    await svc.reassign_user_class(db_session, user.id, other)
    ac = authed_client_factory(admin_user)
    assert (await ac.get(f"/classes/{sc.id}/members")).json() == []
    assert (await ac.delete(f"/classes/{sc.id}/members/{entry.id}")).status_code == 204
    assert (await svc.resolve_user_class(db_session, user)).id == other.id
    assert all(not role["holders"] for role in (await ac.get(f"/classes/{sc.id}/roles")).json())
