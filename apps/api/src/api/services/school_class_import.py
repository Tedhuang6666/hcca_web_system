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

from api.core.clock import local_today
from api.models.person import (
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationSource,
    PersonAffiliationStatus,
)
from api.models.school_class import (
    ClassMembership,
    ClassMembershipStatus,
    ClassRosterEntry,
    SchoolClass,
)
from api.models.user import User
from api.schemas.school_class import (
    ClassRosterPdfImportOut,
    SchoolClassCreate,
)
from api.services import school_class as class_svc

_ROSTER_LINE = re.compile(
    r"^(?P<prefix>.+?)\s+(?P<class_code>\d{3})\s+"
    r"(?P<seat_number>\d{1,3})\s+(?P<student_id>\d{5,20})"
    r"(?:\s+\d+)?\s*$"
)
_ACADEMIC_YEAR_IN_FILENAME = re.compile(r"(?<!\d)(\d{2,3})[-－]")
_CONTACT_DIRECTORY_ROW = re.compile(
    r"(?P<email>[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})"
    r"(?P<display_name>[\u4e00-\u9fff]{2,8})\s*"
    r"(?P<student_id>\d{5,20})\s*"
    r"(?P<class_code>\d{3})\s*"
    r"(?P<seat_number>\d{1,3})\s+09\d{8}"
)


@dataclass(frozen=True)
class ParsedRosterRow:
    display_name: str
    class_code: str
    seat_number: int
    student_id: str


@dataclass(frozen=True)
class ParsedContactDirectoryRow(ParsedRosterRow):
    email: str


def parse_contact_directory_text(text: str) -> list[ParsedContactDirectoryRow]:
    """解析 Google 表單匯出的幹部通訊錄 PDF 文字。"""
    rows: list[ParsedContactDirectoryRow] = []
    seen_student_ids: set[str] = set()
    seen_emails: set[str] = set()

    for match in _CONTACT_DIRECTORY_ROW.finditer(text):
        email = re.sub(r"^\d{4}/\d{1,2}/\d{1,2}", "", match.group("email")).lower()
        student_id = match.group("student_id")
        if student_id in seen_student_ids:
            raise ValueError(f"通訊錄中的學號 {student_id} 重複")
        if email in seen_emails:
            raise ValueError(f"通訊錄中的 Email {email} 重複")
        seen_student_ids.add(student_id)
        seen_emails.add(email)
        rows.append(
            ParsedContactDirectoryRow(
                display_name=match.group("display_name"),
                class_code=match.group("class_code"),
                seat_number=int(match.group("seat_number")),
                student_id=student_id,
                email=email,
            )
        )
    return rows


def parse_roster_pdf_text(text: str) -> list[ParsedRosterRow]:
    """解析校方編班 PDF 的文字表格，忽略頁首與頁尾。"""
    directory_rows = parse_contact_directory_text(text)
    if directory_rows:
        return [
            ParsedRosterRow(
                display_name=row.display_name,
                class_code=row.class_code,
                seat_number=row.seat_number,
                student_id=row.student_id,
            )
            for row in directory_rows
        ]

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


def parse_contact_directory_pdf(file_bytes: bytes) -> list[ParsedContactDirectoryRow]:
    """讀取幹部通訊錄 PDF，保留寄送通知所需的 Email。"""
    if not file_bytes.startswith(b"%PDF"):
        raise ValueError("上傳檔案不是有效的 PDF")
    try:
        reader = PdfReader(BytesIO(file_bytes), strict=False)
        if reader.is_encrypted:
            raise ValueError("不支援有密碼的 PDF")
        if len(reader.pages) > 100:
            raise ValueError("PDF 頁數過多，請確認上傳的是幹部通訊錄")
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except PdfReadError as exc:
        raise ValueError("無法讀取 PDF，請確認檔案未損毀") from exc
    rows = parse_contact_directory_text(text)
    if not rows:
        raise ValueError("PDF 中找不到可辨識的幹部通訊錄資料")
    return rows


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


async def _load_import_users(session: AsyncSession, rows: list[ParsedRosterRow]) -> dict[str, User]:
    student_ids = {row.student_id for row in rows}
    result = await session.execute(select(User).where(User.student_id.in_(student_ids)))
    users_by_student_id: dict[str, User] = {}
    for user in result.scalars():
        if user.student_id is None:
            continue
        if user.student_id in users_by_student_id:
            raise ValueError(f"學號 {user.student_id} 對應多個使用者，請先清理帳號資料")
        users_by_student_id[user.student_id] = user
    return users_by_student_id


async def _import_people_and_affiliations(
    session: AsyncSession,
    rows: list[ParsedRosterRow],
    classes_by_code: dict[str, SchoolClass],
    users_by_student_id: dict[str, User],
    academic_year: int,
) -> tuple[int, int, int]:
    student_ids = {row.student_id for row in rows}
    people_result = await session.execute(select(Person).where(Person.student_id.in_(student_ids)))
    people_by_student_id = {
        person.student_id: person
        for person in people_result.scalars()
        if person.student_id is not None
    }
    people_created = 0
    people_updated = 0
    for row in rows:
        user = users_by_student_id.get(row.student_id)
        person = people_by_student_id.get(row.student_id)
        if person is None:
            person = Person(
                student_id=row.student_id,
                display_name=row.display_name,
                email=user.email if user else None,
                user_id=user.id if user else None,
            )
            session.add(person)
            people_by_student_id[row.student_id] = person
            people_created += 1
            continue
        person.display_name = row.display_name
        if user is not None and person.user_id is None:
            person.user_id = user.id
        if user is not None and not person.email:
            person.email = user.email
        people_updated += 1
    await session.flush()

    person_ids = [person.id for person in people_by_student_id.values()]
    class_ids = [school_class.id for school_class in classes_by_code.values()]
    affiliation_result = await session.execute(
        select(PersonAffiliation).where(
            PersonAffiliation.person_id.in_(person_ids),
            PersonAffiliation.class_id.in_(class_ids),
            PersonAffiliation.kind == PersonAffiliationKind.CLASS_MEMBER,
            PersonAffiliation.status.in_(
                [PersonAffiliationStatus.ACTIVE, PersonAffiliationStatus.PENDING_USER]
            ),
        )
    )
    existing_affiliations = {
        (affiliation.person_id, affiliation.class_id, affiliation.org_id)
        for affiliation in affiliation_result.scalars()
    }
    affiliations_created = 0
    for row in rows:
        person = people_by_student_id[row.student_id]
        school_class = classes_by_code[row.class_code]
        key = (person.id, school_class.id, school_class.org_id)
        if key in existing_affiliations:
            continue
        session.add(
            PersonAffiliation(
                person_id=person.id,
                kind=PersonAffiliationKind.CLASS_MEMBER,
                academic_year=academic_year,
                class_id=school_class.id,
                org_id=school_class.org_id,
                source=PersonAffiliationSource.IMPORT,
                status=PersonAffiliationStatus.ACTIVE,
            )
        )
        existing_affiliations.add(key)
        affiliations_created += 1
    await session.flush()
    return people_created, people_updated, affiliations_created


async def _bulk_upsert_roster(
    session: AsyncSession,
    rows: list[ParsedRosterRow],
    classes_by_code: dict[str, SchoolClass],
    users_by_student_id: dict[str, User],
) -> tuple[int, int]:
    class_ids = [school_class.id for school_class in classes_by_code.values()]
    academic_year_by_class_id = {
        school_class.id: school_class.academic_year for school_class in classes_by_code.values()
    }
    existing_result = await session.execute(
        select(ClassRosterEntry).where(ClassRosterEntry.class_id.in_(class_ids))
    )
    by_seat: dict[tuple[uuid.UUID, int], ClassRosterEntry] = {}
    by_student_id: dict[tuple[uuid.UUID, str], ClassRosterEntry] = {}
    for entry in existing_result.scalars():
        by_seat[(entry.class_id, entry.seat_number)] = entry
        by_student_id[(entry.class_id, entry.student_id)] = entry

    roster_created = 0
    roster_updated = 0
    previous_user_ids: set[tuple[uuid.UUID, uuid.UUID]] = set()
    new_user_ids: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for row in rows:
        class_id = classes_by_code[row.class_code].id
        student_id = row.student_id.strip()
        user = users_by_student_id.get(student_id)
        by_seat_entry = by_seat.get((class_id, row.seat_number))
        by_student_entry = by_student_id.get((class_id, student_id))
        if by_seat_entry is not None and by_student_entry not in (None, by_seat_entry):
            raise ValueError(
                f"{row.class_code} 班 {row.seat_number} 號與學號 {student_id} 分屬不同名冊資料"
            )
        entry = by_seat_entry or by_student_entry
        if entry is None:
            entry = ClassRosterEntry(
                class_id=class_id,
                seat_number=row.seat_number,
                student_id=student_id,
                user_id=user.id if user else None,
            )
            session.add(entry)
            roster_created += 1
        else:
            old_seat_key = (class_id, entry.seat_number)
            old_student_key = (class_id, entry.student_id)
            if entry.user_id is not None and entry.user_id != (user.id if user else None):
                previous_user_ids.add((class_id, entry.user_id))
            entry.seat_number = row.seat_number
            entry.student_id = student_id
            entry.user_id = user.id if user else None
            if by_seat.get(old_seat_key) is entry and old_seat_key != (class_id, row.seat_number):
                by_seat.pop(old_seat_key)
            if by_student_id.get(old_student_key) is entry and old_student_key != (
                class_id,
                student_id,
            ):
                by_student_id.pop(old_student_key)
            roster_updated += 1
        if user is not None:
            new_user_ids.add((class_id, user.id))
        by_seat[(class_id, row.seat_number)] = entry
        by_student_id[(class_id, student_id)] = entry
    await session.flush()

    membership_keys = previous_user_ids | new_user_ids
    membership_result = await session.execute(
        select(ClassMembership).where(
            ClassMembership.class_id.in_(class_ids),
            ClassMembership.user_id.in_({user_id for _, user_id in membership_keys}),
            ClassMembership.status == ClassMembershipStatus.ACTIVE,
        )
    )
    active_memberships = {
        (membership.class_id, membership.user_id): membership
        for membership in membership_result.scalars()
    }
    today = local_today()
    for class_id, user_id in previous_user_ids - new_user_ids:
        membership = active_memberships.get((class_id, user_id))
        if membership is not None and membership.source == "roster":
            membership.status = ClassMembershipStatus.ENDED
            membership.end_date = today
    for class_id, user_id in new_user_ids:
        if (class_id, user_id) in active_memberships:
            continue
        session.add(
            ClassMembership(
                class_id=class_id,
                user_id=user_id,
                academic_year=academic_year_by_class_id[class_id],
                source="roster",
                status=ClassMembershipStatus.ACTIVE,
                start_date=today,
            )
        )
    await session.flush()
    return roster_created, roster_updated


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
    users_by_student_id = await _load_import_users(session, rows)
    people_created, people_updated, affiliations_created = await _import_people_and_affiliations(
        session,
        rows,
        classes_by_code,
        users_by_student_id,
        resolved_year,
    )
    roster_created, roster_updated = await _bulk_upsert_roster(
        session,
        rows,
        classes_by_code,
        users_by_student_id,
    )

    return ClassRosterPdfImportOut(
        academic_year=resolved_year,
        class_codes=class_codes,
        classes_created=classes_created,
        total=len(rows),
        people_created=people_created,
        people_updated=people_updated,
        affiliations_created=affiliations_created,
        roster_created=roster_created,
        roster_updated=roster_updated,
    )
