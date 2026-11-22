"""明確補齊 AuditLog 連續未簽章尾段，不重簽任何既有 hash。

何時跑：
- 欄位 migration 套用後，檢查稽核資料並決定要明確補齊未簽章資料時。
- 寫入路徑遇到缺 hash 而停止後，先調查原因，再決定是否執行。

用法：
    wsl -d Ubuntu -- bash -lc 'cd ~/projects/main && \
        uv run --project apps/api python apps/api/scripts/backfill_audit_hash_chain.py'

行為：
- 按 (created_at, id) 排序所有 AuditLog
- 第一筆 prev_hash = GENESIS_HASH
- 逐筆使用目前 HMAC key 計算 self_hash 並寫回
- batch commit（預設每 500 筆）

可重跑：既有 hash 必須驗證正確；不一致時停止，不覆寫或重簽。
"""

from __future__ import annotations

import asyncio
import hmac
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
    async with AsyncSessionLocal() as db:
        stmt = select(AuditLog).order_by(AuditLog.created_at, AuditLog.id)
        result = await db.execute(stmt)
        rows = list(result.scalars().all())
        summary, updates = _prepare_backfill(rows)

        for i, (row, prev_hash, self_hash) in enumerate(updates, start=1):
            row.prev_hash = prev_hash
            row.self_hash = self_hash
            if i % BATCH_SIZE == 0:
                await db.commit()
                logger.info(
                    "checkpoint at row %d (fixed=%d skipped=%d)",
                    i,
                    summary["fixed"],
                    summary["already_correct"],
                )

        await db.commit()

    logger.info("backfill complete: %s", summary)
    return summary


def _prepare_backfill(
    rows: list[AuditLog],
) -> tuple[dict[str, int], list[tuple[AuditLog, str, str]]]:
    """規劃連續未簽章尾段；驗證既有資料並拒絕重簽不一致的 hash。"""
    fixed = 0
    skipped = 0
    prev_hash = audit_chain.GENESIS_HASH
    backfill_started = False
    updates: list[tuple[AuditLog, str, str]] = []

    for row in rows:
        if row.self_hash is None and row.prev_hash is None:
            backfill_started = True
            self_hash = audit_chain.compute_self_hash(row, prev_hash)
            updates.append((row, prev_hash, self_hash))
            fixed += 1
        else:
            if backfill_started:
                raise audit_chain.AuditChainIntegrityError(
                    f"稽核鏈在未簽章資料後又出現既有 hash：{row.id}"
                )
            if not row.self_hash or row.prev_hash != prev_hash:
                raise audit_chain.AuditChainIntegrityError(f"既有稽核鏈缺漏或連結不一致：{row.id}")
            expected = audit_chain.compute_expected_self_hash(
                row,
                prev_hash,
                row.self_hash,
            )
            if expected is None or not hmac.compare_digest(expected, row.self_hash):
                raise audit_chain.AuditChainIntegrityError(
                    f"既有稽核 hash 驗證失敗，拒絕重簽：{row.id}"
                )
            skipped += 1

            self_hash = row.self_hash
        prev_hash = self_hash

    return {"total": len(rows), "fixed": fixed, "already_correct": skipped}, updates


def main() -> int:
    asyncio.run(_backfill())
    return 0


if __name__ == "__main__":
    sys.exit(main())
