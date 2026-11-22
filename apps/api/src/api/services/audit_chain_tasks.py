"""稽核日誌雜湊鏈相關 Celery tasks（ADR-004）。

排程（建議加入 celery_app.conf.beat_schedule）：
- 每日 00:05  compute_daily_audit_anchor   產生當日 anchor
- 每週六 03:00 verify_audit_chain_integrity 完整性掃描

若未設定 BACKUP_S3_BUCKET，僅寫入 DB anchor；設定後會以固定 key 上傳 JSON anchor。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import desc, func, select

from api.core.celery_app import celery_app
from api.core.clock import local_today
from api.core.config import settings
from api.models.audit_anchor import AuditLogAnchor
from api.models.audit_log import AuditLog
from api.services import audit_chain

logger = logging.getLogger(__name__)


async def _compute_anchor_async() -> dict:
    """計算昨日的 anchor 並寫入。"""
    from api.core.database import task_session

    today = local_today()
    yesterday = today - timedelta(days=1)
    start = datetime.combine(yesterday, datetime.min.time(), tzinfo=UTC)
    end = datetime.combine(today, datetime.min.time(), tzinfo=UTC)

    async with task_session() as db:
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

        # 設定遠端儲存時同步上傳 anchor。
        s3_status = "skipped"
        s3_object = None
        try:
            s3_object = await asyncio.to_thread(_upload_anchor_to_s3, anchor)
            if s3_object:
                anchor.s3_object_url = s3_object
                anchor.s3_uploaded_at = datetime.now(UTC)
                await db.commit()
                s3_status = "uploaded"
        except Exception:  # pragma: no cover
            logger.exception("audit anchor S3 upload or state persistence failed")
            s3_status = "failed"

        return {
            "status": "ok",
            "anchor_date": yesterday.isoformat(),
            "log_count": log_count,
            "head_hash": head_hash[:16] + "...",
            "s3": s3_status,
            "s3_object": s3_object,
        }


def _upload_anchor_to_s3(anchor: AuditLogAnchor) -> str | None:
    """將 anchor 以 deterministic JSON key 寫入備份 bucket。"""
    import boto3

    bucket = settings.BACKUP_S3_BUCKET.strip()
    if not bucket:
        return None

    prefix = settings.BACKUP_S3_PREFIX.strip("/")
    key_parts = [part for part in (prefix, "audit-anchors", f"{anchor.anchor_date}.json") if part]
    object_key = "/".join(key_parts)
    payload = json.dumps(
        {
            "anchor_date": anchor.anchor_date.isoformat(),
            "last_audit_log_id": str(anchor.last_audit_log_id)
            if anchor.last_audit_log_id
            else None,
            "head_hash": anchor.head_hash,
            "log_count": anchor.log_count,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    payload_sha256 = hashlib.sha256(payload).hexdigest()
    client = boto3.client("s3", region_name=settings.BACKUP_S3_REGION)
    client.put_object(
        Bucket=bucket,
        Key=object_key,
        Body=payload,
        ContentType="application/json",
        Metadata={
            "anchor-date": anchor.anchor_date.isoformat(),
            "head-hash": anchor.head_hash,
            "payload-sha256": payload_sha256,
        },
    )
    object_uri = f"s3://{bucket}/{object_key}"
    logger.info(
        "audit_anchor_uploaded date=%s key=%s head=%s count=%d",
        anchor.anchor_date,
        object_key,
        anchor.head_hash[:16],
        anchor.log_count,
    )
    return object_uri


@celery_app.task(
    name="api.services.audit_chain_tasks.compute_daily_audit_anchor",
    bind=True,
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def compute_daily_audit_anchor(self) -> dict:  # type: ignore[type-arg]
    """每日 00:05 跑（建議）。產生昨日 anchor。"""
    return asyncio.run(_compute_anchor_async())


async def _verify_chain_async(days: int) -> dict:
    """重算最近 N 天的 hash chain、回報異常數。"""
    from api.core.database import task_session

    since = datetime.now(UTC) - timedelta(days=days)
    async with task_session() as db:
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


@celery_app.task(
    name="api.services.audit_chain_tasks.verify_audit_chain_integrity",
    bind=True,
    max_retries=3,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def verify_audit_chain_integrity(self, days: int = 7) -> dict:  # type: ignore[type-arg]
    """每週六 03:00 跑（建議）。重算最近 N 天 chain。"""
    return asyncio.run(_verify_chain_async(days))


__all__ = [
    "compute_daily_audit_anchor",
    "verify_audit_chain_integrity",
]
