"""四欄校方名冊：真實 DB 驗證座號衝突、帳號歸屬及重跑。"""

from datetime import UTC, datetime
from io import BytesIO
from zipfile import ZipFile

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.person import Person, PersonAffiliation
from api.models.school_class import ClassMembership, ClassRosterEntry, SchoolClass
from api.models.user import User
from api.models.user_identity import UserIdentity
from api.services.school_directory_import import (
    SchoolDirectoryRow,
    import_school_directory,
    parse_school_directory,
)


def row(sid: str, seat: int, code: str = "101") -> SchoolDirectoryRow:
    return SchoolDirectoryRow(f"g0{sid}@hchs.hc.edu.tw", sid, code, seat)


def workbook(*, formula: bool = False) -> bytes:
    content = BytesIO()
    with ZipFile(content, "w") as archive:
        ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        archive.writestr("xl/workbook.xml", f"<workbook {ns}><sheets><sheet/></sheets></workbook>")
        values = ["信箱", "學號", "班級", "座號", "g0510001@hchs.hc.edu.tw", "510001", "101", "1"]
        cells = []
        for i, values_row in enumerate((values[:4], values[4:]), start=1):
            cells.append(f'<row r="{i}">')
            for column, value in zip("ABCD", values_row, strict=True):
                f = "<f>1+0</f>" if formula and i == 2 and column == "D" else ""
                cells.append(f'<c r="{column}{i}" t="inlineStr">{f}<is><t>{value}</t></is></c>')
            cells.append("</row>")
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            f"<worksheet {ns}><sheetData>{''.join(cells)}</sheetData></worksheet>",
        )
    return content.getvalue()


def test_parse_xlsx_and_reject_formula() -> None:
    assert parse_school_directory(workbook()) == [row("510001", 1)]
    with pytest.raises(ValueError, match="公式"):
        parse_school_directory(workbook(formula=True))


@pytest.mark.parametrize(
    "line",
    [
        "g0510002@hchs.hc.edu.tw,510001,101,1",
        "g0510001@hchs.hc.edu.tw,510001,101,0",
        "g0510001@hchs.hc.edu.tw,510001,401,1",
    ],
)
def test_reject_invalid_identity_or_seat(line: str) -> None:
    with pytest.raises(ValueError):
        parse_school_directory(("信箱,學號,班級,座號\n" + line).encode())


def test_reject_duplicate_seats() -> None:
    with pytest.raises(ValueError, match="重複"):
        parse_school_directory(
            (
                "信箱,學號,班級,座號\n"
                "g0510001@hchs.hc.edu.tw,510001,101,1\n"
                "g0510002@hchs.hc.edu.tw,510002,101,1\n"
            ).encode()
        )


async def setup_class(db: AsyncSession) -> tuple[User, SchoolClass]:
    actor = User(email="directory-admin@test.edu", display_name="名冊維護員")
    db.add(actor)
    await db.flush()
    sc = SchoolClass(academic_year=115, class_code="101", grade=1, created_by=actor.id)
    db.add(sc)
    await db.flush()
    return actor, sc


async def test_swap_seats_preserves_ids_names_and_accounts(db_session: AsyncSession) -> None:
    actor, sc = await setup_class(db_session)
    user = User(email="personal@test.edu", display_name="登入姓名")
    db_session.add(user)
    await db_session.flush()
    db_session.add(
        UserIdentity(
            user_id=user.id,
            provider="google",
            external_id="school-test",
            linked_at=datetime.now(UTC),
            email="g0510001@hchs.hc.edu.tw",
        )
    )
    person = Person(user_id=user.id, display_name="既有 人名", email=user.email)
    db_session.add(person)
    a = ClassRosterEntry(class_id=sc.id, student_id="510001", seat_number=2)
    b = ClassRosterEntry(class_id=sc.id, student_id="510002", seat_number=1)
    db_session.add_all([a, b])
    await db_session.flush()
    ids = (person.id, a.id, b.id)
    rows = [row("510001", 1), row("510002", 2)]
    result = await import_school_directory(
        db_session, rows=rows, academic_year=115, created_by=actor.id
    )
    assert result["seat_conflicts_resolved"] == 2
    assert result["users_student_id_filled"] == 1
    assert (person.id, a.id, b.id) == ids
    assert (a.seat_number, b.seat_number, a.user_id) == (1, 2, user.id)
    assert (person.display_name, user.email, user.student_id) == (
        "既有 人名",
        "personal@test.edu",
        "510001",
    )
    assert person.email == rows[0].email
    assert user.display_name == "登入姓名"
    repeated = await import_school_directory(
        db_session, rows=rows, academic_year=115, created_by=actor.id
    )
    assert repeated["people_created"] == repeated["roster_created"] == 0
    assert repeated["seat_conflicts_resolved"] == 0


async def test_replace_unlinked_stale_seat_preserves_person(db_session: AsyncSession) -> None:
    actor, sc = await setup_class(db_session)
    person = Person(student_id="599999", display_name="舊人員")
    db_session.add(person)
    await db_session.flush()
    db_session.add_all(
        [
            ClassRosterEntry(class_id=sc.id, student_id="599999", seat_number=1),
            PersonAffiliation(
                person_id=person.id,
                kind="class_member",
                academic_year=115,
                class_id=sc.id,
                status="active",
                source="import",
            ),
        ]
    )
    await db_session.flush()
    result = await import_school_directory(
        db_session, rows=[row("510001", 1)], academic_year=115, created_by=actor.id
    )
    assert result["stale_roster_removed"] == result["affiliations_ended"] == 1
    assert await db_session.get(Person, person.id) is person
    entry = await db_session.scalar(
        select(ClassRosterEntry).where(ClassRosterEntry.class_id == sc.id)
    )
    assert entry.student_id == "510001"
    new_person = await db_session.scalar(select(Person).where(Person.student_id == "510001"))
    assert (new_person.display_name, new_person.email) == (
        "尚未提供姓名",
        "g0510001@hchs.hc.edu.tw",
    )


async def test_ambiguous_accounts_fail_before_changing_data(db_session: AsyncSession) -> None:
    actor, _ = await setup_class(db_session)
    a = User(email="first@test.edu", display_name="甲", student_id="510001")
    b = User(email="g0510001@hchs.hc.edu.tw", display_name="乙")
    db_session.add_all([a, b])
    await db_session.flush()
    with pytest.raises(ValueError, match="多個帳號"):
        await import_school_directory(
            db_session, rows=[row("510001", 1)], academic_year=115, created_by=actor.id
        )
    assert b.student_id is None
    assert not (await db_session.scalars(select(ClassRosterEntry))).all()


async def test_transfer_ends_old_membership_but_preserves_role(db_session: AsyncSession) -> None:
    actor, previous = await setup_class(db_session)
    destination = SchoolClass(academic_year=115, class_code="102", grade=1, created_by=actor.id)
    user = User(email="g0510001@hchs.hc.edu.tw", display_name="學生", student_id="510001")
    db_session.add_all([destination, user])
    await db_session.flush()
    person = Person(user_id=user.id, student_id=user.student_id, display_name="學生")
    db_session.add(person)
    await db_session.flush()
    entry = ClassRosterEntry(
        class_id=previous.id, student_id="510001", seat_number=1, user_id=user.id
    )
    old_membership = ClassMembership(class_id=previous.id, user_id=user.id, academic_year=115)
    role = PersonAffiliation(
        person_id=person.id,
        kind="class_role",
        class_id=previous.id,
        academic_year=115,
        status="active",
        source="manual",
    )
    db_session.add_all([entry, old_membership, role])
    await db_session.flush()
    entry_id = entry.id
    async with db_session.begin_nested() as transaction:
        result = await import_school_directory(
            db_session, rows=[row("510001", 2, "102")], academic_year=115, created_by=actor.id
        )
        assert result["memberships_ended"] == 1
        assert entry.id == entry_id and entry.class_id == destination.id
        assert old_membership.status == "ended"
        assert role.status == "active"
        await transaction.rollback()
    await db_session.refresh(entry)
    await db_session.refresh(old_membership)
    assert entry.class_id == previous.id and entry.seat_number == 1
    assert old_membership.status == "active"
