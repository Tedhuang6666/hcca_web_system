"""稽核日誌雜湊鏈相關 Celery tasks。Phase B2 / ADR-004。

排程（建議加入 celery_app.conf.beat_schedule）：
- 每日 00:05  compute_daily_audit_anchor   產生當日 anchor
- 每週六 03:00 verify_audit_chain_integrity 完整性掃描

S3 上傳目前 stub：若 BACKUP_S3_BUCKET 未設則僅寫 DB anchor、不上 S3。
完整 S3 + Object Lock 等 A3 wire 完成後再啟用。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import desc, func, select

from api.core.celery_app import celery_app
from api.core.config import settings
from api.models.audit_anchor import AuditLogAnchor
from api.models.audit_log import AuditLog
from api.services import audit_chain

logger = logging.getLogger(__name__)


async def _compute_anchor_async() -> dict:
    """計算昨日的 anchor 並寫入。"""
    from api.core.database import AsyncSessionLocal

    today = datetime.now(UTC).date()
    yesterday = today - timedelta(days=1)
    start = datetime.combine(yesterday, datetime.min.time(), tzinfo=UTC)
    end = datetime.combine(today, datetime.min.time(), tzinfo=UTC)

    async with AsyncSessionLocal() as db:
        # 是否已有
        exist = await db.execute(
            select(AuditLogAnchor).where(AuditLogAnchor.anchor_date == yesterday)
        )
        if exist.scalar_one_or_none() is not None:
            return {"status": "skipped", "reason": "anchor already exists"}

        # 該日所有 audit logs
        rows_stmt = (
            select(AuditLog)
            .where(AuditLog.created_at >= start)
            .where(AuditLog.created_at < end)
            .order_by(AuditLog.created_at, AuditLog.id)
        )
        rows = list((await db.execute(rows_stmt)).scalars().all())

        if rows:
            last_log = rows[-1]
            head_hash = last_log.self_hash or audit_chain.GENESIS_HASH
            log_count = len(rows)
            last_log_id = last_log.id
        else:
            # 該日無紀錄 → 沿用前一日的 head_hash
            prev_stmt = select(AuditLogAnchor).order_by(desc(AuditLogAnchor.anchor_date)).limit(1)
            prev = (await db.execute(prev_stmt)).scalar_one_or_none()
            head_hash = prev.head_hash if prev else audit_chain.GENESIS_HASH
            log_count = 0
            last_log_id = None

        anchor = AuditLogAnchor(
            anchor_date=yesterday,
            last_audit_log_id=last_log_id,
            head_hash=head_hash,
            log_count=log_count,
        )
        db.add(anchor)
        await db.commit()
        await db.refresh(anchor)

        # S3 上傳（A3 wire 完成後啟用）
        s3_status = "skipped"
        if settings.BACKUP_S3_BUCKET:
            try:
                _ = _upload_anchor_to_s3(anchor)
                s3_status = "uploaded"
            except Exception:  # pragma: no cover
                logger.exception("audit anchor s3 upload failed")
                s3_status = "failed"

        return {
            "status": "ok",
            "anchor_date": yesterday.isoformat(),
            "log_count": log_count,
            "head_hash": head_hash[:16] + "...",
            "s3": s3_status,
        }


def _upload_anchor_to_s3(anchor: AuditLogAnchor) -> str:
    """stub：實際 S3 上傳邏輯由 A3 接 boto3 完成。

    回傳上傳後的 object URL。目前僅記 log。
    """
    logger.info(
        "audit_anchor_upload_stub date=%s head=%s count=%d",
        anchor.anchor_date,
        anchor.head_hash[:16],
        anchor.log_count,
    )
    return ""


@celery_app.task(name="api.services.audit_chain_tasks.compute_daily_audit_anchor")
def compute_daily_audit_anchor() -> dict:
    """每日 00:05 跑（建議）。產生昨日 anchor。"""
    return asyncio.run(_compute_anchor_async())


async def _verify_chain_async(days: int) -> dict:
    """重算最近 N 天的 hash chain、回報異常數。"""
    from api.core.database import AsyncSessionLocal

    since = datetime.now(UTC) - timedelta(days=days)
    async with AsyncSessionLocal() as db:
        issues = await audit_chain.verify_integrity_range(db, since=since)
        # 同時更新 anchor 的 integrity_verified_at
        if not issues:
            await db.execute(
                AuditLogAnchor.__table__.update()
                .where(AuditLogAnchor.anchor_date >= since.date())
                .values(integrity_verified_at=datetime.now(UTC))
            )
            await db.commit()

        # 統計
        total_stmt = select(func.count()).select_from(AuditLog).where(AuditLog.created_at >= since)
        total = (await db.execute(total_stmt)).scalar() or 0

    summary = {
        "since": since.isoformat(),
        "total_rows": total,
        "issues_count": len(issues),
        "issues_sample": issues[:5],
    }
    if issues:
        logger.error("audit_chain_integrity_failed: %s", summary)
    else:
        logger.info("audit_chain_integrity_ok: %s", summary)
    return summary


@celery_app.task(name="api.services.audit_chain_tasks.verify_audit_chain_integrity")
def verify_audit_chain_integrity(days: int = 7) -> dict:
    """每週六 03:00 跑（建議）。重算最近 N 天 chain。"""
    return asyncio.run(_verify_chain_async(days))


__all__ = [
    "compute_daily_audit_anchor",
    "verify_audit_chain_integrity",
]
