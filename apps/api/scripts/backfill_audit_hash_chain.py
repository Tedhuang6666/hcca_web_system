"""Backfill 既有 AuditLog 的 prev_hash / self_hash。Phase B2 一次性遷移工具。

何時跑：
- Phase B2 migration 套用後（columns 已加但 NULL）
- 在啟用 audit_chain.write_audit_log_with_chain 寫入路徑之前

用法：
    wsl -d Ubuntu -- bash -lc 'cd ~/projects/main && \
        uv run --project apps/api python apps/api/scripts/backfill_audit_hash_chain.py'

行為：
- 按 (created_at, id) 排序所有 AuditLog
- 第一筆 prev_hash = GENESIS_HASH
- 逐筆計算 self_hash 並寫回
- batch commit（預設每 500 筆）

冪等：可重跑、不會改已有正確 hash 的 row。
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

# 允許獨立執行：把 src 加進 sys.path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from sqlalchemy import select  # noqa: E402

from api.core.database import AsyncSessionLocal  # noqa: E402
from api.models.audit_log import AuditLog  # noqa: E402
from api.services import audit_chain  # noqa: E402

logger = logging.getLogger("backfill_audit_hash_chain")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

BATCH_SIZE = 500


async def _backfill() -> dict:
    fixed = 0
    skipped = 0
    total = 0
    prev_hash = audit_chain.GENESIS_HASH

    async with AsyncSessionLocal() as db:
        stmt = select(AuditLog).order_by(AuditLog.created_at, AuditLog.id)
        result = await db.execute(stmt)
        rows = list(result.scalars().all())

        for i, row in enumerate(rows):
            total += 1
            expected_self = audit_chain.compute_self_hash(row, prev_hash)

            if row.self_hash == expected_self and row.prev_hash == prev_hash:
                skipped += 1
            else:
                row.prev_hash = prev_hash
                row.self_hash = expected_self
                fixed += 1

            prev_hash = expected_self

            if (i + 1) % BATCH_SIZE == 0:
                await db.commit()
                logger.info(
                    "checkpoint at row %d (fixed=%d skipped=%d)",
                    i + 1,
                    fixed,
                    skipped,
                )

        await db.commit()

    summary = {
        "total": total,
        "fixed": fixed,
        "already_correct": skipped,
    }
    logger.info("backfill complete: %s", summary)
    return summary


def main() -> int:
    asyncio.run(_backfill())
    return 0


if __name__ == "__main__":
    sys.exit(main())
