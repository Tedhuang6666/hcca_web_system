"""班級範圍查詢應保留歸屬規則，且查詢數不隨班級數成長。"""

import uuid
from collections.abc import Callable
from datetime import timedelta

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.person import (
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationStatus,
)
from api.models.school_class import (
    ClassManualMember,
    ClassRosterEntry,
    ClassStudentRange,
    SchoolClass,
)
from api.models.user import User
from api.services import school_class as svc


async def _make_class(db: AsyncSession, creator: User, **overrides: object) -> SchoolClass:
    values: dict[str, object] = {
        "academic_year": 115,
        "class_code": uuid.uuid4().hex[:10],
        "created_by": creator.id,
        "ranges": [],
        "roster_entries": [],
        "manual_members": [],
    }
    values.update(overrides)
    school_class = SchoolClass(**values)
    db.add(school_class)
    await db.flush()
    return school_class


@pytest.mark.parametrize("class_count", [1, 60])
async def test_active_class_lookup_has_bounded_queries(
    db_session: AsyncSession, admin_user: User, make_user: Callable, class_count: int
) -> None:
    user = await make_user(student_id="510007")
    target = await _make_class(
        db_session,
        admin_user,
        ranges=[ClassStudentRange(student_id_start="510001", student_id_end="510040")],
    )
    for _ in range(class_count - 1):
        await _make_class(db_session, admin_user)

    query_count = 0

    def count_query(*args: object) -> None:
        nonlocal query_count
        query_count += 1

    connection = (await db_session.connection()).sync_connection
    event.listen(connection, "before_cursor_execute", count_query)
    try:
        result = await svc.get_user_active_class_ids(db_session, user.id)
    finally:
        event.remove(connection, "before_cursor_execute", count_query)

    assert result == {target.id}
    assert query_count <= 6, f"{class_count} classes required {query_count} queries"


async def test_active_class_lookup_preserves_membership_sources_and_transfer_rules(
    db_session: AsyncSession, admin_user: User, make_user: Callable
) -> None:
    user = await make_user(student_id="510007")
    other = await make_user(student_id="510008")
    person = Person(user_id=user.id, display_name="測試學生")
    other_person = Person(user_id=other.id, display_name="另一位學生")
    db_session.add_all([person, other_person])
    await db_session.flush()
    classes = []
    expected = set()
    today = local_today()

    for scenario in (
        "range",
        "manual",
        "linked_roster",
        "unlinked_roster",
        "foreign_roster",
        "ended_range",
        "ended_manual",
        "rejoined_range",
        "future_rejoin",
        "expired_rejoin",
        "other_user_ended",
        "inactive",
    ):
        ranged = scenario not in {"manual", "linked_roster", "unlinked_roster", "foreign_roster"}
        school_class = await _make_class(
            db_session,
            admin_user,
            is_active=scenario != "inactive",
            ranges=[ClassStudentRange(student_id_start="0510001", student_id_end="0510040")]
            if ranged
            else [],
        )
        classes.append(school_class)
        if scenario in {"manual", "ended_manual", "inactive"}:
            school_class.manual_members.append(ClassManualMember(user_id=user.id))
        if scenario in {"linked_roster", "unlinked_roster", "foreign_roster"}:
            school_class.roster_entries.append(
                ClassRosterEntry(
                    seat_number=1,
                    student_id="different" if scenario == "linked_roster" else user.student_id,
                    user_id=other.id
                    if scenario == "foreign_roster"
                    else user.id
                    if scenario == "linked_roster"
                    else None,
                )
            )
        if scenario in {
            "ended_range",
            "ended_manual",
            "rejoined_range",
            "future_rejoin",
            "expired_rejoin",
            "other_user_ended",
        }:
            db_session.add(
                PersonAffiliation(
                    person_id=other_person.id if scenario == "other_user_ended" else person.id,
                    class_id=school_class.id,
                    kind=PersonAffiliationKind.CLASS_MEMBER,
                    status=PersonAffiliationStatus.ENDED,
                    start_date=today - timedelta(days=30),
                    end_date=today - timedelta(days=1),
                )
            )
        if scenario in {"rejoined_range", "future_rejoin", "expired_rejoin"}:
            db_session.add(
                PersonAffiliation(
                    person_id=person.id,
                    class_id=school_class.id,
                    kind=PersonAffiliationKind.CLASS_MEMBER,
                    status=PersonAffiliationStatus.ACTIVE,
                    start_date=today + timedelta(days=1)
                    if scenario == "future_rejoin"
                    else today - timedelta(days=2),
                    end_date=today - timedelta(days=1)
                    if scenario == "expired_rejoin"
                    else None
                    if scenario == "future_rejoin"
                    else today,
                )
            )
        if scenario not in {
            "foreign_roster",
            "ended_range",
            "future_rejoin",
            "expired_rejoin",
            "inactive",
        }:
            expected.add(school_class.id)

    await db_session.flush()
    assert {
        sc.id for sc in classes if sc.is_active and await svc.is_class_member(db_session, sc, user)
    } == expected
    assert await svc.get_user_active_class_ids(db_session, user.id) == expected
    assert await svc.get_user_active_class_ids(db_session, other.id) == {
        sc.id for sc in classes if sc.is_active and await svc.is_class_member(db_session, sc, other)
    }


async def test_active_class_lookup_without_student_id_or_user(
    db_session: AsyncSession, admin_user: User, make_user: Callable
) -> None:
    user = await make_user()
    manual = await _make_class(
        db_session, admin_user, manual_members=[ClassManualMember(user_id=user.id)]
    )
    await _make_class(
        db_session,
        admin_user,
        ranges=[ClassStudentRange(student_id_start="510001", student_id_end="510040")],
    )
    assert await svc.get_user_active_class_ids(db_session, user.id) == {manual.id}
    assert await svc.get_user_active_class_ids(db_session, uuid.uuid4()) == set()
