"""預約寄送 Celery task — 掃描到期的 SCHEDULED 郵件，解析收件人後寄出。"""

from __future__ import annotations

import asyncio
import logging

from api.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    name="api.services.email_tasks.process_scheduled_emails", bind=True, max_retries=0
)
def process_scheduled_emails(self) -> dict:  # type: ignore[type-arg]
    """Celery Beat task：寄出已到期的預約郵件（同步入口，內部以 asyncio 執行）。"""
    return asyncio.run(_dispatch_scheduled())


async def _dispatch_scheduled() -> dict:
    from datetime import UTC, datetime

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

    from api.core.config import settings
    from api.email.sender import enqueue_rendered, render_generic_message
    from api.models.email_message import EmailMessage, EmailStatus
    from api.services.recipient import resolve_recipients, spec_to_resolve_kwargs

    engine = create_async_engine(str(settings.DATABASE_URL))
    dispatched = 0
    try:
        async with AsyncSession(engine) as session:
            now = datetime.now(UTC)
            rows = (
                (
                    await session.execute(
                        select(EmailMessage)
                        .where(
                            EmailMessage.status == EmailStatus.SCHEDULED,
                            EmailMessage.scheduled_at <= now,
                        )
                        .limit(50)
                    )
                )
                .scalars()
                .all()
            )
            for msg in rows:
                try:
                    # 寄送當下才解析收件人，反映最新職位/組織成員
                    _users, emails = await resolve_recipients(
                        session, **spec_to_resolve_kwargs(msg.recipient_spec or {})
                    )
                    if not emails:
                        msg.status = EmailStatus.FAILED
                        msg.error_detail = "解析後無有效收件人"
                        continue
                    html = render_generic_message(msg.subject, msg.body, msg.context or {})
                    task_ids = enqueue_rendered(emails, msg.subject, html)
                    msg.resolved_emails = emails
                    msg.recipient_count = len(emails)
                    msg.status = EmailStatus.QUEUED
                    msg.celery_task_id = task_ids[0] if task_ids else None
                    msg.error_detail = None
                    dispatched += 1
                except Exception as exc:  # noqa: BLE001
                    msg.status = EmailStatus.FAILED
                    msg.error_detail = str(exc)[:500]
                    logger.warning("預約郵件 %s 寄送失敗: %s", msg.id, exc)
            await session.commit()
    finally:
        await engine.dispose()
    return {"status": "ok", "dispatched": dispatched}
