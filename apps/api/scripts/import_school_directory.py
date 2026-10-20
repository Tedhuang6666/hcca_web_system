#!/usr/bin/env python3
"""校方四欄名冊維護入口：預設演練並 rollback；備份後才能使用 --apply。

uv run --locked --project apps/api python apps/api/scripts/import_school_directory.py \
    roster.xlsx --academic-year 115 --actor-id UUID [--apply]

請先指定目標 DATABASE_URL，正式環境由操作者先做可還原的 DB 備份。
輸出只含計數與來源 SHA256；名冊、備份、整理後 CSV 均不得加入版控。
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sqlalchemy import select, text  # noqa: E402

from api.core.database import AsyncSessionLocal, advisory_xact_lock, engine  # noqa: E402
from api.models.user import User  # noqa: E402
from api.services import audit, audit_chain  # noqa: E402
from api.services.school_directory_import import (  # noqa: E402
    import_school_directory,
    parse_school_directory,
)


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--academic-year", required=True, type=int)
    parser.add_argument("--actor-id", required=True, type=uuid.UUID)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    content = args.file.read_bytes()
    rows = parse_school_directory(content)
    digest = hashlib.sha256(content).hexdigest()
    try:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                await advisory_xact_lock(session, audit_chain.AUDIT_CHAIN_LOCK_KEY)
                if session.bind is not None and session.bind.dialect.name == "postgresql":
                    # 與網站的寫入互斥；取得不到鎖即停止，不帶著過期比對結果寫入。
                    await session.execute(text("SET LOCAL lock_timeout = '3s'"))
                    await session.execute(
                        text(
                            "LOCK TABLE users, user_identities, people, school_classes, "
                            "class_roster_entries, class_memberships, class_manual_members, "
                            "person_affiliations IN SHARE ROW EXCLUSIVE MODE"
                        )
                    )
                if await session.scalar(select(User.id).where(User.id == args.actor_id)) is None:
                    raise ValueError("指定的操作人員帳號不存在")
                result = await import_school_directory(
                    session, rows=rows, academic_year=args.academic_year, created_by=args.actor_id
                )
                await audit.record(
                    session,
                    entity_type="school_directory",
                    entity_id=str(
                        uuid.uuid5(
                            uuid.NAMESPACE_URL,
                            f"hcca:school-directory:{args.academic_year}:{digest}",
                        )
                    ),
                    action="import",
                    actor_id=str(args.actor_id),
                    meta={"source_sha256": digest, **result},
                    summary="匯入校方信箱學號班級座號名冊",
                )
                if not args.apply:
                    await session.rollback()
            print(json.dumps({"applied": args.apply, "source_sha256": digest, **result}))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
