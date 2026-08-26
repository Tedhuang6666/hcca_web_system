"""班聯會幹部通訊錄一鍵匯入測試。"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.org import Org, Position, UserPosition
from api.models.user import User
from api.schemas.school_class import ClassRosterPdfImportOut
from api.services import cadre_import
from api.services.school_class_import import ParsedContactDirectoryRow


@pytest.mark.asyncio
async def test_import_hchs_cadre_directory_creates_roles_and_is_idempotent(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    actor = User(
        email=f"cadre-import-{uuid.uuid4().hex[:8]}@example.edu",
        display_name="匯入管理員",
        is_superuser=True,
    )
    db_session.add(actor)
    await db_session.flush()

    names = sorted({assignment.display_name for assignment in cadre_import._CADRE_ASSIGNMENTS})
    rows = [
        ParsedContactDirectoryRow(
            display_name=name,
            student_id=f"41{index:04d}",
            class_code="201" if index % 2 else "202",
            seat_number=index + 1,
            email=f"cadre-{index}@example.edu",
        )
        for index, name in enumerate(names, start=1)
    ]

    async def fake_roster_import(_session: AsyncSession, **_: object) -> ClassRosterPdfImportOut:
        return ClassRosterPdfImportOut(
            academic_year=115,
            class_codes=["201", "202"],
            classes_created=2,
            total=len(rows),
            people_created=0,
            people_updated=0,
            affiliations_created=0,
            roster_created=len(rows),
            roster_updated=0,
        )

    async def ignore_cache(_: str) -> None:
        return None

    monkeypatch.setattr(
        cadre_import.class_import_svc, "parse_contact_directory_pdf", lambda _: rows
    )
    monkeypatch.setattr(cadre_import.class_import_svc, "import_roster_pdf", fake_roster_import)
    monkeypatch.setattr(cadre_import, "cache_invalidate_user_permissions", ignore_cache)

    result = await cadre_import.import_hchs_cadre_directory(
        db_session,
        file_bytes=b"%PDF-test",
        filename="directory.pdf",
        academic_year=115,
        term_start=date(2026, 8, 1),
        term_end=date(2027, 7, 31),
        actor=actor,
    )

    assert result.cadre_members == len(names)
    assert result.users_created == len(names)
    assert result.assignments_created == len(cadre_import._CADRE_ASSIGNMENTS)
    assert result.positions_created == 16
    assert await db_session.scalar(select(Org).where(Org.name == "班級聯合自治會"))
    assert len((await db_session.execute(select(Position))).scalars().all()) == 16
    assert len((await db_session.execute(select(UserPosition))).scalars().all()) == len(
        cadre_import._CADRE_ASSIGNMENTS
    )

    repeated = await cadre_import.import_hchs_cadre_directory(
        db_session,
        file_bytes=b"%PDF-test",
        filename="directory.pdf",
        academic_year=115,
        term_start=date(2026, 8, 1),
        term_end=date(2027, 7, 31),
        actor=actor,
    )

    assert repeated.users_created == 0
    assert repeated.users_reused == len(names)
    assert repeated.assignments_created == 0
