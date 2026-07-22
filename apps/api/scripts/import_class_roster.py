#!/usr/bin/env python3
"""匯入版本化班級名冊資料。

預設只驗證 CSV；加入 ``--apply`` 才會寫入資料庫。匯入可重複執行：
既有班級會檢查設定，名冊則依班級座號／學號做 upsert。

用法：
    uv run --project apps/api python apps/api/scripts/import_class_roster.py
    uv run --project apps/api python apps/api/scripts/import_class_roster.py --apply
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
from dataclasses import dataclass
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = APP_ROOT / "src"
if SRC_ROOT.exists():
    sys.path.insert(0, str(SRC_ROOT))

from sqlalchemy import select  # noqa: E402

from api.core.database import AsyncSessionLocal  # noqa: E402
from api.models.school_class import SchoolClass  # noqa: E402
from api.schemas.school_class import (  # noqa: E402
    ClassRosterBulkCreate,
    ClassRosterEntryCreate,
)
from api.services import school_class as class_svc  # noqa: E402

DEFAULT_DATA_PATH = APP_ROOT / "data" / "class_rosters" / "115_grade2.csv"
REQUIRED_COLUMNS = (
    "student_id",
    "source_class_code",
    "source_seat_number",
    "target_class_code",
    "target_seat_number",
    "status",
)
TARGET_CLASS_CODES = frozenset(f"2{i:02d}" for i in range(1, 17))


@dataclass(frozen=True)
class RosterRow:
    student_id: str
    source_class_code: str
    source_seat_number: int
    target_class_code: str | None
    target_seat_number: int | None
    status: str


def _parse_optional_int(value: str, *, row_number: int, column: str) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"第 {row_number} 列 {column} 不是整數：{value}") from exc


def load_rows(path: Path) -> list[RosterRow]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if tuple(reader.fieldnames or ()) != REQUIRED_COLUMNS:
            raise ValueError(
                f"CSV 欄位不符，預期 {REQUIRED_COLUMNS}，實際 {tuple(reader.fieldnames or ())}"
            )

        rows: list[RosterRow] = []
        for row_number, raw in enumerate(reader, start=2):
            student_id = (raw["student_id"] or "").strip()
            source_class_code = (raw["source_class_code"] or "").strip()
            status = (raw["status"] or "").strip()
            if not student_id or not student_id.isdigit():
                raise ValueError(f"第 {row_number} 列學號無效：{student_id!r}")
            if status not in {"active", "suspended"}:
                raise ValueError(f"第 {row_number} 列狀態無效：{status!r}")
            try:
                source_seat_number = int(raw["source_seat_number"] or "")
            except ValueError as exc:
                raise ValueError(f"第 {row_number} 列原座號不是整數") from exc
            if source_seat_number < 1:
                raise ValueError(f"第 {row_number} 列原座號必須大於 0")

            target_class_code = (raw["target_class_code"] or "").strip() or None
            target_seat_number = _parse_optional_int(
                (raw["target_seat_number"] or "").strip(),
                row_number=row_number,
                column="target_seat_number",
            )
            if status == "active":
                if target_class_code not in TARGET_CLASS_CODES:
                    raise ValueError(f"第 {row_number} 列目標班級無效：{target_class_code!r}")
                if target_seat_number is None or target_seat_number < 1:
                    raise ValueError(f"第 {row_number} 列在籍資料缺少有效新座號")
            elif target_class_code is not None or target_seat_number is not None:
                raise ValueError(f"第 {row_number} 列休學資料不應有目標班級／座號")

            rows.append(
                RosterRow(
                    student_id=student_id,
                    source_class_code=source_class_code,
                    source_seat_number=source_seat_number,
                    target_class_code=target_class_code,
                    target_seat_number=target_seat_number,
                    status=status,
                )
            )

    if not rows:
        raise ValueError("CSV 沒有名冊資料")
    if len({row.student_id for row in rows}) != len(rows):
        raise ValueError("CSV 含重複學號")

    active_rows = [row for row in rows if row.status == "active"]
    target_seats = {(row.target_class_code, row.target_seat_number) for row in active_rows}
    if len(target_seats) != len(active_rows):
        raise ValueError("CSV 含重複的目標班級／座號")
    if {row.target_class_code for row in active_rows} != TARGET_CLASS_CODES:
        raise ValueError("CSV 未完整涵蓋 201–216 班")
    return rows


def summarize(rows: list[RosterRow]) -> dict[str, object]:
    active_rows = [row for row in rows if row.status == "active"]
    counts: dict[str, int] = {}
    for row in active_rows:
        assert row.target_class_code is not None
        counts[row.target_class_code] = counts.get(row.target_class_code, 0) + 1
    return {
        "total_rows": len(rows),
        "active_rows": len(active_rows),
        "suspended_rows": len(rows) - len(active_rows),
        "target_class_counts": dict(sorted(counts.items())),
    }


async def _get_existing_classes(session, *, academic_year: int):
    existing_rows = (
        (
            await session.execute(
                select(SchoolClass).where(
                    SchoolClass.academic_year == academic_year,
                    SchoolClass.class_code.in_(TARGET_CLASS_CODES),
                )
            )
        )
        .scalars()
        .all()
    )
    classes = {school_class.class_code: school_class for school_class in existing_rows}
    missing = sorted(TARGET_CLASS_CODES - set(classes))
    if missing:
        raise RuntimeError(f"找不到既有班級，僅匯入名冊不會自動建立班級：{', '.join(missing)}")

    for class_code in sorted(TARGET_CLASS_CODES):
        school_class = classes[class_code]
        if school_class.grade != 2 or not school_class.is_active:
            raise RuntimeError(
                f"既有班級 {academic_year}-{class_code} 設定不符，未自動覆寫："
                f"grade={school_class.grade}, is_active={school_class.is_active}"
            )

    return classes


async def apply_rows(session, *, academic_year: int, rows: list[RosterRow]) -> dict[str, object]:
    classes = await _get_existing_classes(session, academic_year=academic_year)
    active_rows = [row for row in rows if row.status == "active"]
    created = updated = linked = 0

    for class_code in sorted(classes):
        school_class = await class_svc.get_class(session, classes[class_code].id)
        if school_class is None:
            raise RuntimeError(f"找不到班級：{academic_year}-{class_code}")
        class_rows = [row for row in active_rows if row.target_class_code == class_code]
        result = await class_svc.bulk_upsert_roster(
            session,
            school_class,
            data=ClassRosterBulkCreate(
                entries=[
                    ClassRosterEntryCreate(
                        seat_number=row.target_seat_number,
                        student_id=row.student_id,
                    )
                    for row in sorted(class_rows, key=lambda item: item.target_seat_number or 0)
                ]
            ),
        )
        created += result.created
        updated += result.updated
        linked += sum(1 for entry in result.entries if entry.user_id is not None)

    return {
        "classes": len(classes),
        "roster_created": created,
        "roster_updated": updated,
        "account_links": linked,
        "active_rows": len(active_rows),
    }


async def run(*, data_path: Path, academic_year: int, apply: bool) -> None:
    rows = load_rows(data_path)
    summary = summarize(rows)
    if not apply:
        print(json.dumps({"mode": "dry-run", **summary}, ensure_ascii=False))
        return

    async with AsyncSessionLocal() as session, session.begin():
        result = await apply_rows(session, academic_year=academic_year, rows=rows)
    print(json.dumps({"mode": "apply", **summary, **result}, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="寫入資料庫；未指定時只驗證 CSV")
    parser.add_argument("--academic-year", type=int, default=115)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA_PATH)
    args = parser.parse_args()
    asyncio.run(run(data_path=args.data, academic_year=args.academic_year, apply=args.apply))


if __name__ == "__main__":
    main()
