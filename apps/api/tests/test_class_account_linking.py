"""名冊先建立、帳號後登入及未歸戶申請的回歸測試。"""

from collections.abc import Callable

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.org import UserPosition
from api.models.user import User
from api.schemas.school_class import (
    ClassMembershipCreate,
    ClassRoleAssign,
    ClassRosterEntryCreate,
    SchoolClassCreate,
)
from api.services import school_class as class_svc


async def make_class(db: AsyncSession, actor: User, code: str = "101"):
    return await class_svc.create_class(
        db,
        data=SchoolClassCreate(academic_year=115, class_code=code, grade=1),
        created_by=actor.id,
    )


async def test_late_account_links_roster_members_and_student_context(
    db_session: AsyncSession,
    admin_user: User,
    make_user: Callable,
    authed_client_factory: Callable[[User], AsyncClient],
):
    sc = await make_class(db_session, admin_user)
    entry = await class_svc.add_roster_entry(
        db_session, sc, data=ClassRosterEntryCreate(seat_number=7, student_id="510007")
    )
    assert entry.user_id is None
    student = await make_user(email="late@school.test", student_id="510007")
    admin = authed_client_factory(admin_user)
    roster = await admin.get(f"/classes/{sc.id}/roster")
    assert roster.status_code == 200
    assert roster.json()[0]["user_id"] == str(student.id)
    members = await admin.get(f"/classes/{sc.id}/members")
    assert [(row["id"], row["seat_number"]) for row in members.json()] == [(str(student.id), 7)]
    mine = await authed_client_factory(student).get("/classes/me")
    assert mine.status_code == 200
    assert (mine.json()["id"], mine.json()["seat_number"]) == (str(sc.id), 7)


async def test_linking_preserves_manual_transfer(
    db_session: AsyncSession,
    admin_user: User,
    make_user: Callable,
):
    old = await make_class(db_session, admin_user)
    new = await make_class(db_session, admin_user, "102")
    entry = await class_svc.add_roster_entry(
        db_session, old, data=ClassRosterEntryCreate(seat_number=1, student_id="510001")
    )
    student = await make_user(email="transfer@school.test", student_id="510001")
    await class_svc.reassign_user_class(db_session, student.id, new)
    await class_svc.link_roster_accounts(db_session, user_id=student.id)
    assert entry.user_id is None
    assert (await class_svc.resolve_user_class(db_session, student)).id == new.id
    assert not await class_svc.list_class_members(db_session, old)


async def test_linking_does_not_replace_an_existing_account(
    db_session: AsyncSession,
    admin_user: User,
    make_user: Callable,
):
    sc = await make_class(db_session, admin_user)
    owner = await make_user(email="roster-owner@school.test", student_id="510002")
    entry = await class_svc.add_roster_entry(
        db_session, sc, data=ClassRosterEntryCreate(seat_number=2, student_id="510002")
    )
    owner.student_id = None
    await db_session.flush()
    other = await make_user(email="other@school.test", student_id="510002")
    await class_svc.link_roster_accounts(db_session, user_id=other.id)
    assert entry.user_id == owner.id
    assert await class_svc.resolve_user_class(db_session, other) is None


async def test_ending_membership_also_ends_person_affiliation(
    db_session: AsyncSession,
    admin_user: User,
    member_user: User,
):
    sc = await make_class(db_session, admin_user)
    await class_svc.add_membership(
        db_session, sc, data=ClassMembershipCreate(user_id=member_user.id)
    )
    assert (await class_svc.resolve_user_class(db_session, member_user)).id == sc.id
    assert await class_svc.end_membership(db_session, sc.id, member_user.id)
    assert await class_svc.resolve_user_class(db_session, member_user) is None
    assert not await class_svc.list_class_members(db_session, sc)


async def test_repeated_assignment_does_not_duplicate_position(
    db_session: AsyncSession,
    admin_user: User,
    member_user: User,
):
    sc = await make_class(db_session, admin_user)
    data = ClassRoleAssign(user_id=member_user.id)
    first = await class_svc.assign_class_role(db_session, sc, role_key="class_leader", data=data)
    second = await class_svc.assign_class_role(db_session, sc, role_key="class_leader", data=data)
    assert first.id == second.id
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(UserPosition)
            .where(
                UserPosition.user_id == member_user.id,
                UserPosition.position_id == first.position_id,
            )
        )
        == 1
    )


async def test_unassigned_student_can_request_class_and_admin_can_approve(
    db_session: AsyncSession,
    admin_user: User,
    member_user: User,
    authed_client_factory: Callable[[User], AsyncClient],
    make_user: Callable,
):
    sc = await make_class(db_session, admin_user)
    student = authed_client_factory(member_user)
    response = await student.post(
        "/classes/correction-requests", json={"requested_class_id": str(sc.id)}
    )
    assert response.status_code == 201
    request = response.json()
    assert request["reported_class_id"] is None
    assert (
        await student.post("/classes/correction-requests", json={"requested_class_id": str(sc.id)})
    ).status_code == 409
    other = await make_user(email="another-student@school.test")
    assert (
        await authed_client_factory(other).get("/classes/correction-requests/mine")
    ).json() == []
    assert (
        await student.post(
            f"/classes/correction-requests/{request['id']}/review", json={"status": "approved"}
        )
    ).status_code == 403
    approval = await authed_client_factory(admin_user).post(
        f"/classes/correction-requests/{request['id']}/review", json={"status": "approved"}
    )
    assert approval.status_code == 200
    assert (await student.get("/classes/me")).json()["id"] == str(sc.id)


async def test_unassigned_class_request_requires_login(client: AsyncClient):
    response = await client.post(
        "/classes/correction-requests",
        json={"requested_class_id": "00000000-0000-0000-0000-000000000001"},
    )
    assert response.status_code == 401


async def test_google_login_links_preimported_person_and_roster(
    db_session: AsyncSession,
    admin_user: User,
):
    from api.models.person import Person
    from api.routers.auth import _upsert_google_user

    sc = await make_class(db_session, admin_user)
    person = Person(display_name="預先匯入的同學", student_id="510009")
    db_session.add(person)
    entry = await class_svc.add_roster_entry(
        db_session, sc, data=ClassRosterEntryCreate(seat_number=9, student_id="510009")
    )
    user = await _upsert_google_user(
        db_session,
        google_sub="synthetic-late-student",
        email="g0510009@hchs.hc.edu.tw",
        display_name="登入的同學",
        avatar_url=None,
        client_ip="127.0.0.1",
        user_agent="class-linking-test",
    )
    assert person.user_id == user.id
    assert entry.user_id == user.id
    again = await _upsert_google_user(
        db_session,
        google_sub="synthetic-late-student",
        email=user.email,
        display_name=user.display_name,
        avatar_url=None,
        client_ip="127.0.0.1",
        user_agent="class-linking-test",
    )
    assert again.id == user.id


async def test_person_affiliations_report_account_link_without_membership(
    db_session: AsyncSession,
    admin_user: User,
    member_user: User,
):
    from api.models.person import Person, PersonAffiliation, PersonAffiliationKind

    sc = await make_class(db_session, admin_user)
    linked = Person(display_name="已連結人員", user_id=member_user.id)
    unlinked = Person(display_name="待連結人員", student_id="510099")
    db_session.add_all([linked, unlinked])
    await db_session.flush()
    for person in (linked, unlinked):
        db_session.add(
            PersonAffiliation(
                person_id=person.id,
                class_id=sc.id,
                kind=PersonAffiliationKind.CLASS_MEMBER,
                academic_year=sc.academic_year,
            )
        )
    await db_session.flush()
    members = {member.id: member for member in await class_svc.list_class_members(db_session, sc)}
    assert members[member_user.id].user_id == member_user.id
    assert members[unlinked.id].user_id is None
    assert not await class_svc.list_memberships(db_session, sc)
