"""班級編班名單檔案匯入測試。"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.user import User
from api.services import school_class as class_svc
from api.services.school_class_import import (
    import_roster_pdf,
    parse_roster_csv_text,
    parse_roster_pdf_text,
)


def test_parse_roster_pdf_text_extracts_name_class_seat_and_student_id() -> None:
    rows = parse_roster_pdf_text(
        """
        姓名 遮罩 畢業國民中學名稱 班級 座號 學號
        王○勛 新竹市立培英國民中學 101 1 510001
        林○毅 新竹縣立成功國民中學 101 7 510007 112419
        """
    )

    assert [
        (row.display_name, row.class_code, row.seat_number, row.student_id) for row in rows
    ] == [
        ("王○勛", "101", 1, "510001"),
        ("林○毅", "101", 7, "510007"),
    ]


def test_parse_roster_csv_text_accepts_import_file_headers() -> None:
    rows = parse_roster_csv_text(
        "display_name,class_code,seat_number,student_id\n王○勛,101,1,510001\n"
    )

    assert len(rows) == 1
    assert rows[0].display_name == "王○勛"
    assert rows[0].student_id == "510001"


async def test_import_roster_file_creates_classes_people_and_seats(
    db_session: AsyncSession,
) -> None:
    actor = User(
        email=f"import-{uuid.uuid4().hex[:8]}@test.edu",
        display_name="匯入測試管理員",
    )
    db_session.add(actor)
    await db_session.flush()

    result = await import_roster_pdf(
        db_session,
        file_bytes=(
            "display_name,class_code,seat_number,student_id\n"
            "王○勛,101,1,510001\n"
            "林○毅,101,2,510007\n"
        ).encode(),
        filename="115-1-roster-import.csv",
        academic_year=None,
        created_by=actor.id,
    )

    assert result.academic_year == 115
    assert result.class_codes == ["101"]
    assert (result.classes_created, result.people_created) == (1, 2)
    assert (result.affiliations_created, result.roster_created) == (2, 2)

    school_class = await class_svc.get_class(
        db_session,
        (await class_svc.list_classes(db_session, academic_year=115))[0].id,
    )
    members = await class_svc.list_class_members(db_session, school_class)
    assert [(member.seat_number, member.student_id) for member in members] == [
        (1, "510001"),
        (2, "510007"),
    ]
