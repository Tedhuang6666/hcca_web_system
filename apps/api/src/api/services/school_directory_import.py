"""匯入無姓名的校方信箱／學號名冊；以學號保留人員與帳號關聯。

只補人員與班級名冊，不建立登入帳號或授予職位。由呼叫端控制交易與備份。
"""

from __future__ import annotations

import csv
import re
import uuid
from dataclasses import dataclass
from io import BytesIO, StringIO
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from sqlalchemy import select
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
    ClassMembership,
    ClassMembershipStatus,
    ClassRosterEntry,
    SchoolClass,
)
from api.models.user import User
from api.models.user_identity import UserIdentity
from api.services.school_class_import import import_roster_pdf

_HEADERS = ("信箱", "學號", "班級", "座號")
_NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


@dataclass(frozen=True)
class SchoolDirectoryRow:
    email: str
    student_id: str
    class_code: str
    seat_number: int


def validate_directory(rows: list[SchoolDirectoryRow]) -> None:
    if not rows:
        raise ValueError("名冊不得為空")
    seen_ids: set[str] = set()
    seen_emails: set[str] = set()
    seen_seats: set[tuple[str, int]] = set()
    for line, row in enumerate(rows, start=2):
        if (
            not re.fullmatch(r"\d{6}", row.student_id)
            or row.email != f"g0{row.student_id}@hchs.hc.edu.tw"
            or not re.fullmatch(r"[123]\d{2}", row.class_code)
            or not 1 <= row.seat_number <= 100
        ):
            raise ValueError(f"第 {line} 列的信箱、學號、班級或座號格式不符")
        seat = (row.class_code, row.seat_number)
        if row.student_id in seen_ids or row.email in seen_emails or seat in seen_seats:
            raise ValueError(f"第 {line} 列的學號、信箱或班級座號重複")
        seen_ids.add(row.student_id)
        seen_emails.add(row.email)
        seen_seats.add(seat)


def parse_school_directory(file_bytes: bytes) -> list[SchoolDirectoryRow]:
    """讀取單工作表 XLSX 或 UTF-8 CSV；錯誤只回報列號，不輸出個資。"""
    if file_bytes.startswith(b"PK"):
        try:
            with ZipFile(BytesIO(file_bytes)) as archive:
                if sum(item.file_size for item in archive.infolist()) > 20_000_000:
                    raise ValueError("名冊解壓後過大")
                workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
                sheets = workbook.find("s:sheets", _NS)
                if sheets is None or len(sheets) != 1:
                    raise ValueError("名冊須只有一個工作表")
                strings = []
                if "xl/sharedStrings.xml" in archive.namelist():
                    strings = [
                        "".join(item.itertext())
                        for item in ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
                    ]
                table = []
                root = ElementTree.fromstring(archive.read("xl/worksheets/sheet1.xml"))
                for source_row in root.findall("s:sheetData/s:row", _NS):
                    cells = {}
                    for cell in source_row:
                        if cell.find("s:f", _NS) is not None:
                            raise ValueError("名冊不得包含公式")
                        column = re.sub(r"\d", "", cell.get("r", ""))
                        value = cell.findtext("s:v", "", _NS)
                        if cell.get("t") == "s":
                            value = strings[int(value)]
                        elif cell.get("t") == "inlineStr":
                            value = "".join(cell.find("s:is", _NS).itertext())  # type: ignore[union-attr]
                        cells[column] = value
                    if any(cells.values()):
                        if set(cells) - {"A", "B", "C", "D"}:
                            raise ValueError("名冊只能包含信箱、學號、班級、座號四欄")
                        table.append([cells.get(column, "") for column in ("A", "B", "C", "D")])
        except (BadZipFile, KeyError, IndexError, ElementTree.ParseError) as exc:
            raise ValueError("無法讀取名冊 XLSX") from exc
    else:
        try:
            table = list(csv.reader(StringIO(file_bytes.decode("utf-8-sig"))))
        except UnicodeDecodeError as exc:
            raise ValueError("名冊須為 XLSX 或 UTF-8 CSV") from exc
    if not table or tuple(table[0]) != _HEADERS:
        raise ValueError("欄位須依序為：信箱、學號、班級、座號")
    rows = []
    for line, values in enumerate(table[1:], start=2):
        if len(values) != 4:
            raise ValueError(f"第 {line} 列須有四欄")
        email, student_id, class_code, seat = (value.strip() for value in values)
        try:
            seat_number = int(seat)
        except ValueError as exc:
            raise ValueError(f"第 {line} 列座號須為整數") from exc
        rows.append(SchoolDirectoryRow(email.lower(), student_id, class_code, seat_number))
    validate_directory(rows)
    return sorted(rows, key=lambda row: (row.class_code, row.seat_number))


async def import_school_directory(
    session: AsyncSession,
    *,
    rows: list[SchoolDirectoryRow],
    academic_year: int,
    created_by: uuid.UUID,
) -> dict[str, int]:
    """學號優先校正座號，保留人名、帳號、職位與歷史資料；不 commit。"""
    validate_directory(rows)
    users = list((await session.scalars(select(User))).all())
    identities = list((await session.scalars(select(UserIdentity))).all())
    people = list((await session.scalars(select(Person))).all())
    users_by_id = {user.id: user for user in users}
    users_by_student = {user.student_id: user for user in users if user.student_id}
    email_users: dict[str, set[uuid.UUID]] = {}
    for account in users:
        email_users.setdefault(account.email.lower(), set()).add(account.id)
    for identity in identities:
        if identity.email:
            email_users.setdefault(identity.email.lower(), set()).add(identity.user_id)
    people_by_student = {person.student_id: person for person in people if person.student_id}
    people_by_user = {person.user_id: person for person in people if person.user_id}
    linked: dict[str, User] = {}
    selected: dict[str, Person] = {}
    user: User | None
    # 所有身分歧義先拒絕，再開始寫入；不推測或合併不同使用者的帳號。
    for line, row in enumerate(rows, start=2):
        matches = set(email_users.get(row.email, set()))
        if user := users_by_student.get(row.student_id):
            matches.add(user.id)
        if len(matches) > 1:
            raise ValueError(f"第 {line} 列對應多個帳號，須先確認帳號歸屬")
        person = people_by_student.get(row.student_id)
        if matches:
            user = users_by_id[next(iter(matches))]
            if user.student_id not in (None, row.student_id):
                raise ValueError(f"第 {line} 列信箱已綁定其他學號")
            other = people_by_user.get(user.id)
            if (person and person.user_id not in (None, user.id)) or (
                other
                and (other.student_id not in (None, row.student_id) or person not in (None, other))
            ):
                raise ValueError(f"第 {line} 列人員與帳號關聯衝突")
            linked[row.student_id] = user
            person = person or other
        elif person and person.user_id:
            raise ValueError(f"第 {line} 列人員已連結未匹配的帳號")
        if person:
            selected[row.student_id] = person

    classes = list(
        (
            await session.scalars(
                select(SchoolClass).where(SchoolClass.academic_year == academic_year)
            )
        ).all()
    )
    class_codes = {school_class.id: school_class.class_code for school_class in classes}
    desired = {row.student_id: row for row in rows}
    source_codes = {row.class_code for row in rows}
    targets = {(row.class_code, row.seat_number) for row in rows}
    entries = list(
        (
            await session.scalars(
                select(ClassRosterEntry).where(ClassRosterEntry.class_id.in_(class_codes))
            )
        ).all()
    )
    seen_students: set[str] = set()
    for entry in entries:
        if entry.student_id in desired:
            if entry.student_id in seen_students:
                raise ValueError("同學年度存在重複學號名冊，須先確認歷史歸屬")
            seen_students.add(entry.student_id)
    manual_members = list(
        (
            await session.scalars(
                select(ClassManualMember).where(ClassManualMember.class_id.in_(class_codes))
            )
        ).all()
    )
    linked_ids = {user.id: student_id for student_id, user in linked.items()}
    for member in manual_members:
        if (sid := linked_ids.get(member.user_id)) and class_codes[member.class_id] != desired[
            sid
        ].class_code:
            raise ValueError("名冊與手動班級歸屬衝突，須先確認轉班設定")

    stats = {
        "users_linked": len(linked),
        "users_student_id_filled": 0,
        "seat_conflicts_resolved": 0,
        "stale_roster_removed": 0,
        "affiliations_ended": 0,
        "memberships_ended": 0,
    }
    for row in rows:
        if (user := linked.get(row.student_id)) and user.student_id is None:
            user.student_id = row.student_id
            stats["users_student_id_filled"] += 1
        if person := selected.get(row.student_id):
            person.student_id = row.student_id
            person.email = row.email
    await session.flush()

    # 先騰出座號，讓交換座號和轉班不受立即唯一限制阻擋；交易失敗會整批回滾。
    min_seat = min((entry.seat_number for entry in entries), default=0)
    ended_pairs: set[tuple[str, uuid.UUID]] = set()
    for index, entry in enumerate(entries, start=1):
        code = class_codes[entry.class_id]
        target_row = desired.get(entry.student_id)
        if target_row:
            if code != target_row.class_code or entry.seat_number != target_row.seat_number:
                stats["seat_conflicts_resolved"] += 1
                if code != target_row.class_code:
                    ended_pairs.add((entry.student_id, entry.class_id))
                entry.seat_number = min(0, min_seat) - index
        elif code in source_codes and (code, entry.seat_number) in targets:
            if entry.user_id:
                raise ValueError("被取代的名冊已綁定帳號，須先確認歸屬")
            ended_pairs.add((entry.student_id, entry.class_id))
            await session.delete(entry)
            stats["stale_roster_removed"] += 1
    await session.flush()
    classes_by_code = {school_class.class_code: school_class for school_class in classes}
    for entry in entries:
        if (
            entry.student_id in desired
            and class_codes[entry.class_id] != desired[entry.student_id].class_code
        ):
            destination = classes_by_code.get(desired[entry.student_id].class_code)
            if destination is None:
                raise ValueError("轉班目的班級尚不存在，請先建立班級")
            entry.class_id = destination.id
    await session.flush()

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(("display_name", "class_code", "seat_number", "student_id"))
    names = {}
    for row in rows:
        person = selected.get(row.student_id)
        user = linked.get(row.student_id)
        names[row.student_id] = (
            person.display_name if person else user.display_name if user else "尚未提供姓名"
        )
        # 舊 PDF／CSV parser 會切開姓名中的空白；人名不經過這個中間格式。
        writer.writerow(("尚未提供姓名", row.class_code, row.seat_number, row.student_id))
    result = await import_roster_pdf(
        session,
        file_bytes=output.getvalue().encode(),
        filename=None,
        academic_year=academic_year,
        created_by=created_by,
    )
    stats.update(
        {key: value for key, value in result.model_dump().items() if isinstance(value, int)}
    )
    imported_people = list(
        (await session.scalars(select(Person).where(Person.student_id.in_(desired)))).all()
    )
    for person in imported_people:
        if person.student_id is not None:
            person.email = desired[person.student_id].email
            person.display_name = names[person.student_id]
    today = local_today()
    affiliations = list(
        (
            await session.scalars(
                select(PersonAffiliation).where(
                    PersonAffiliation.class_id.in_(class_codes),
                    PersonAffiliation.kind == PersonAffiliationKind.CLASS_MEMBER,
                    PersonAffiliation.status.in_(
                        [PersonAffiliationStatus.ACTIVE, PersonAffiliationStatus.PENDING_USER]
                    ),
                )
            )
        ).all()
    )
    people_by_id = {person.id: person for person in [*people, *imported_people]}
    for affiliation in affiliations:
        person = people_by_id[affiliation.person_id]
        target_row = desired.get(person.student_id or "")
        if (person.student_id, affiliation.class_id) in ended_pairs or (
            target_row
            and affiliation.class_id is not None
            and class_codes[affiliation.class_id] != target_row.class_code
        ):
            affiliation.status = PersonAffiliationStatus.ENDED
            affiliation.end_date = today
            stats["affiliations_ended"] += 1
    memberships = list(
        (
            await session.scalars(
                select(ClassMembership).where(
                    ClassMembership.academic_year == academic_year,
                    ClassMembership.status == ClassMembershipStatus.ACTIVE,
                    ClassMembership.user_id.in_(linked_ids),
                )
            )
        ).all()
    )
    for membership in memberships:
        if (
            class_codes.get(membership.class_id)
            != desired[linked_ids[membership.user_id]].class_code
        ):
            membership.status = ClassMembershipStatus.ENDED
            membership.end_date = today
            stats["memberships_ended"] += 1
    await session.flush()
    return stats
