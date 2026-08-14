"""班級名冊檔案匯入服務。"""

from __future__ import annotations

import csv
import re
import uuid
from dataclasses import dataclass
from io import BytesIO, StringIO

from pypdf import PdfReader
from pypdf.errors import PdfReadError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.school_class import SchoolClass
from api.schemas.person import PersonRosterImport, PersonRosterImportRow
from api.schemas.school_class import (
    ClassRosterBulkCreate,
    ClassRosterEntryCreate,
    ClassRosterPdfImportOut,
    SchoolClassCreate,
)
from api.services import person as person_svc
from api.services import school_class as class_svc

_ROSTER_LINE = re.compile(
    r"^(?P<prefix>.+?)\s+(?P<class_code>\d{3})\s+"
    r"(?P<seat_number>\d{1,3})\s+(?P<student_id>\d{5,20})"
    r"(?:\s+\d+)?\s*$"
)
_ACADEMIC_YEAR_IN_FILENAME = re.compile(r"(?<!\d)(\d{2,3})[-－]")


@dataclass(frozen=True)
class ParsedRosterRow:
    display_name: str
    class_code: str
    seat_number: int
    student_id: str


def parse_roster_pdf_text(text: str) -> list[ParsedRosterRow]:
    """解析校方編班 PDF 的文字表格，忽略頁首與頁尾。"""
    rows: list[ParsedRosterRow] = []
    seen_seats: set[tuple[str, int]] = set()
    seen_student_ids: set[str] = set()

    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        match = _ROSTER_LINE.match(line)
        if match is None:
            continue
        prefix = match.group("prefix").strip()
        display_name = prefix.split(maxsplit=1)[0] if prefix else ""
        class_code = match.group("class_code")
        seat_number = int(match.group("seat_number"))
        student_id = match.group("student_id")
        if not display_name:
            raise ValueError(f"第 {line_number} 行缺少姓名")
        if (class_code, seat_number) in seen_seats:
            raise ValueError(f"PDF 名單重複座號：{class_code} 班 {seat_number} 號")
        if student_id in seen_student_ids:
            raise ValueError(f"PDF 名單重複學號：{student_id}")
        seen_seats.add((class_code, seat_number))
        seen_student_ids.add(student_id)
        rows.append(
            ParsedRosterRow(
                display_name=display_name,
                class_code=class_code,
                seat_number=seat_number,
                student_id=student_id,
            )
        )

    if not rows:
        raise ValueError("PDF 中找不到可辨識的編班名單資料")
    return rows


def parse_roster_pdf(file_bytes: bytes) -> list[ParsedRosterRow]:
    if not file_bytes.startswith(b"%PDF"):
        raise ValueError("上傳檔案不是有效的 PDF")
    try:
        reader = PdfReader(BytesIO(file_bytes), strict=False)
        if reader.is_encrypted:
            raise ValueError("不支援有密碼的 PDF")
        if len(reader.pages) > 100:
            raise ValueError("PDF 頁數過多，請確認上傳的是編班名單")
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except PdfReadError as exc:
        raise ValueError("無法讀取 PDF，請確認檔案未損毀") from exc
    return parse_roster_pdf_text(text)


def parse_roster_csv_text(text: str) -> list[ParsedRosterRow]:
    """解析可重複上傳的 UTF-8 CSV 匯入檔。"""
    reader = csv.DictReader(StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV 缺少欄位標題")

    def value(row: dict[str, str | None], *names: str) -> str:
        for name in names:
            item = row.get(name)
            if item is not None and item.strip():
                return item.strip()
        return ""

    lines: list[str] = []
    for line_number, row in enumerate(reader, start=2):
        display_name = value(row, "display_name", "student_name", "姓名")
        class_code = value(row, "class_code", "班級")
        seat_number = value(row, "seat_number", "座號")
        student_id = value(row, "student_id", "學號")
        if not all((display_name, class_code, seat_number, student_id)):
            raise ValueError(f"CSV 第 {line_number} 行缺少姓名、班級、座號或學號")
        lines.append(f"{display_name} {class_code} {seat_number} {student_id}")
    return parse_roster_pdf_text("\n".join(lines))


def parse_roster_file(file_bytes: bytes) -> list[ParsedRosterRow]:
    if file_bytes.startswith(b"%PDF"):
        return parse_roster_pdf(file_bytes)
    try:
        text = file_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("匯入檔必須是 PDF 或 UTF-8 CSV") from exc
    return parse_roster_csv_text(text)


def infer_academic_year(filename: str | None) -> int | None:
    if not filename:
        return None
    match = _ACADEMIC_YEAR_IN_FILENAME.search(filename)
    return int(match.group(1)) if match else None


async def import_roster_pdf(
    session: AsyncSession,
    *,
    file_bytes: bytes,
    filename: str | None,
    academic_year: int | None,
    created_by: uuid.UUID,
) -> ClassRosterPdfImportOut:
    rows = parse_roster_file(file_bytes)
    resolved_year = academic_year or infer_academic_year(filename)
    if resolved_year is None:
        raise ValueError("無法從檔名判斷學年度，請手動填寫學年度")

    class_codes = sorted({row.class_code for row in rows})
    existing_result = await session.execute(
        select(SchoolClass).where(
            SchoolClass.academic_year == resolved_year,
            SchoolClass.class_code.in_(class_codes),
        )
    )
    classes_by_code = {
        school_class.class_code: school_class for school_class in existing_result.scalars()
    }
    classes_created = 0
    for class_code in class_codes:
        if class_code in classes_by_code:
            continue
        school_class = await class_svc.create_class(
            session,
            data=SchoolClassCreate(
                academic_year=resolved_year,
                class_code=class_code,
                grade=int(class_code[0]),
                label=f"{resolved_year} 學年度 {class_code} 班",
                ranges=[],
            ),
            created_by=created_by,
        )
        classes_by_code[class_code] = school_class
        classes_created += 1

    person_result = await person_svc.import_roster(
        session,
        data=PersonRosterImport(
            rows=[
                PersonRosterImportRow(
                    student_id=row.student_id,
                    display_name=row.display_name,
                    class_id=classes_by_code[row.class_code].id,
                    academic_year=resolved_year,
                )
                for row in rows
            ]
        ),
    )

    roster_created = 0
    roster_updated = 0
    for class_code in class_codes:
        class_rows = [row for row in rows if row.class_code == class_code]
        result = await class_svc.bulk_upsert_roster(
            session,
            classes_by_code[class_code],
            data=ClassRosterBulkCreate(
                entries=[
                    ClassRosterEntryCreate(
                        seat_number=row.seat_number,
                        student_id=row.student_id,
                    )
                    for row in class_rows
                ]
            ),
        )
        roster_created += result.created
        roster_updated += result.updated

    return ClassRosterPdfImportOut(
        academic_year=resolved_year,
        class_codes=class_codes,
        classes_created=classes_created,
        total=len(rows),
        people_created=person_result.people_created,
        people_updated=person_result.people_updated,
        affiliations_created=person_result.affiliations_created,
        roster_created=roster_created,
        roster_updated=roster_updated,
    )
