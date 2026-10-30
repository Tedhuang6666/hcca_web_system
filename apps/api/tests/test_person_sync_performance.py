"""人員列表補同步的查詢數與歸屬語意回歸。"""

from datetime import timedelta

import pytest
from sqlalchemy import event, func, select

from api.core.clock import local_today
from api.models.org import Org, Position, UserPosition
from api.models.person import (
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationStatus,
)
from api.models.school_class import ClassCadre, ClassMembership, ClassRoleBinding, SchoolClass
from api.services import person as person_svc


@pytest.fixture
async def synced_directory(db_session, admin_user, make_user):
    org = Org(name="查詢效能測試組織")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="查詢效能測試職位")
    school_class = SchoolClass(
        academic_year=115, class_code="101", created_by=admin_user.id, org_id=org.id
    )
    db_session.add_all([position, school_class])
    await db_session.flush()
    db_session.add(
        ClassRoleBinding(class_id=school_class.id, role_key="class_cadre", position_id=position.id)
    )
    people = []
    user_positions = []
    for index in range(24):
        user = await make_user(student_id=f"S{index:06}")
        person = Person(user_id=user.id, student_id=user.student_id, display_name=user.display_name)
        user_position = UserPosition(
            user_id=user.id, position_id=position.id, start_date=local_today()
        )
        db_session.add_all([person, user_position])
        await db_session.flush()
        people.append(person)
        user_positions.append(user_position)
        db_session.add_all(
            [
                ClassMembership(class_id=school_class.id, user_id=user.id, academic_year=115),
                ClassCadre(class_id=school_class.id, user_id=user.id),
                PersonAffiliation(
                    person_id=person.id,
                    kind=PersonAffiliationKind.ORG_POSITION,
                    org_id=org.id,
                    position_id=position.id,
                    synced_user_position_id=user_position.id,
                ),
                PersonAffiliation(
                    person_id=person.id,
                    kind=PersonAffiliationKind.CLASS_MEMBER,
                    class_id=school_class.id,
                    org_id=org.id,
                ),
                PersonAffiliation(
                    person_id=person.id,
                    kind=PersonAffiliationKind.CLASS_ROLE,
                    class_id=school_class.id,
                    org_id=org.id,
                    position_id=position.id,
                    role_key="class_cadre",
                ),
            ]
        )
    await db_session.flush()
    await person_svc.ensure_person_for_user(db_session, admin_user)
    return people, user_positions, school_class, org


async def test_synced_directory_has_bounded_queries(db_session, synced_directory):
    people, user_positions, school_class, org = synced_directory
    person_id = people[0].id
    user_position_id = user_positions[0].id
    user_positions[0].end_date = local_today() - timedelta(days=1)
    affiliation = await db_session.scalar(
        select(PersonAffiliation).where(
            PersonAffiliation.person_id == person_id,
            PersonAffiliation.kind == PersonAffiliationKind.ORG_POSITION,
        )
    )
    affiliation.synced_user_position_id = None
    affiliation.status = PersonAffiliationStatus.PENDING_USER
    await db_session.flush()
    # 模擬新 request，避免測試的 identity map 掩蓋逐筆 SELECT。
    db_session.expunge_all()
    queries = []

    def count_query(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            queries.append(statement)

    bind = db_session.get_bind()
    event.listen(bind, "before_cursor_execute", count_query)
    try:
        await person_svc.sync_people_from_existing_data(db_session)
        await db_session.flush()
    finally:
        event.remove(bind, "before_cursor_execute", count_query)

    assert len(queries) <= 12, f"24 人的既有歸屬補同步執行了 {len(queries)} 次 SELECT"
    affiliations = list(await db_session.scalars(select(PersonAffiliation)))
    assert len(affiliations) == 24 * 3
    expired = next(
        item
        for item in affiliations
        if item.person_id == person_id and item.kind == PersonAffiliationKind.ORG_POSITION
    )
    assert expired.synced_user_position_id == user_position_id
    assert expired.status == PersonAffiliationStatus.ENDED


async def test_sync_reads_new_class_memberships_on_each_call(db_session, synced_directory):
    people, _, school_class, org = synced_directory
    person_id, user_id = people[0].id, people[0].user_id
    await person_svc.sync_people_from_existing_data(db_session)
    other_class = SchoolClass(
        academic_year=115, class_code="102", created_by=school_class.created_by
    )
    db_session.add(other_class)
    await db_session.flush()
    db_session.add(ClassMembership(class_id=other_class.id, user_id=user_id, academic_year=115))
    await db_session.flush()

    for _ in range(2):
        await person_svc.sync_people_from_existing_data(db_session)
    memberships = list(
        await db_session.scalars(
            select(PersonAffiliation).where(
                PersonAffiliation.person_id == person_id,
                PersonAffiliation.kind == PersonAffiliationKind.CLASS_MEMBER,
            )
        )
    )
    assert {(item.class_id, item.org_id) for item in memberships} == {
        (school_class.id, org.id),
        (other_class.id, None),
    }
    assert len(memberships) == 2
    assert await db_session.scalar(select(func.count(UserPosition.id))) == 24
