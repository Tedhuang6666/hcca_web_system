"""Outbox service — 寫入事件和處理器分派"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.outbox import OutboxEvent, OutboxStatus

logger = logging.getLogger(__name__)

_MAX_RETRY = 5


async def emit(
    session: AsyncSession,
    *,
    event_type: str,
    payload: dict[str, Any],
) -> OutboxEvent:
    """在現有事務中寫入一筆 Outbox 事件（同事務 flush，隨主事務 commit 生效）。"""
    event = OutboxEvent(
        event_type=event_type,
        payload=payload,
        status=OutboxStatus.PENDING,
        created_at=datetime.now(UTC),
    )
    session.add(event)
    await session.flush()
    return event


# ── Celery handler（同步，在 Celery worker 中執行）────────────────────────────


def _dispatch(event: OutboxEvent) -> None:
    """根據 event_type 分派到對應的通知邏輯。擴充時在此 switch 新增分支。"""
    from api.services.mail import enqueue_email

    etype = event.event_type
    payload = event.payload

    if etype == "document.approved":
        enqueue_email(
            payload.get("creator_email", ""),
            f"【核准】公文 {payload.get('serial', '')} 已核准",
            f"<p>您的公文「{payload.get('title', '')}」已完成審核。</p>",
        )
    elif etype == "document.rejected":
        enqueue_email(
            payload.get("creator_email", ""),
            f"【退件】公文 {payload.get('serial', '')} 被退件",
            f"<p>退件原因：{payload.get('comment', '（未填）')}</p>",
        )
    elif etype == "regulation.published":
        pass  # 未來：通知訂閱者
    elif etype == "order.created":
        pass  # 未來：購票確認信
    else:
        logger.warning("Unknown outbox event_type: %s", etype)


def process_pending_outbox() -> None:
    """Celery Beat task：掃描並處理 pending outbox events（同步函式）。"""

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from api.core.config import settings

    # 使用同步引擎（Celery task 不在 asyncio event loop）
    sync_url = settings.DATABASE_URL.replace("+asyncpg", "")
    engine = create_engine(sync_url)

    with Session(engine) as session:
        rows = (
            session.execute(
                select(OutboxEvent)
                .where(OutboxEvent.status == OutboxStatus.PENDING)
                .order_by(OutboxEvent.created_at)
                .limit(50)
                .with_for_update(skip_locked=True)
            )
            .scalars()
            .all()
        )

        for event in rows:
            try:
                _dispatch(event)
                event.status = OutboxStatus.PROCESSED
                event.processed_at = datetime.now(UTC)
            except Exception as exc:
                event.retry_count += 1
                event.last_error = str(exc)
                if event.retry_count >= _MAX_RETRY:
                    event.status = OutboxStatus.DEAD
                    logger.error(
                        "Outbox event %s dead after %d retries: %s", event.id, _MAX_RETRY, exc
                    )
                else:
                    logger.warning(
                        "Outbox event %s failed (retry %d): %s", event.id, event.retry_count, exc
                    )
        session.commit()
