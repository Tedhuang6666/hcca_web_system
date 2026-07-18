"""物品借用 Celery 排程任務。

每日 08:00 scan_overdue_loans：
  - 找 status=active 且 due_at < now 的紀錄，批次改為 overdue

每日 09:00 send_loan_reminders：
  - 到期前 1 天且 reminder_sent_count == 0 → 寄提醒信
  - 逾期且 reminder_sent_count < 3，距上次催還 ≥ 2 天 → 再寄催還信
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from api.core.celery_app import celery_app
from api.models.loan import LoanRecord, LoanRecordStatus

logger = logging.getLogger(__name__)

_REMINDER_INTERVAL_DAYS = 2
_MAX_REMINDERS = 3


async def _scan_overdue_async() -> dict:
    from api.core.database import task_session

    now = datetime.now(UTC)
    updated = 0
    async with task_session() as db:
        rows = (
            (
                await db.execute(
                    select(LoanRecord)
                    .where(
                        LoanRecord.status == LoanRecordStatus.ACTIVE,
                        LoanRecord.due_at < now,
                    )
                    .limit(500)
                )
            )
            .scalars()
            .all()
        )
        for record in rows:
            record.status = LoanRecordStatus.OVERDUE
            updated += 1
        await db.commit()
    return {"updated": updated}


async def _send_reminders_async() -> dict:
    from api.core.database import task_session
    from api.email.renderer import render_email
    from api.email.sender import enqueue_rendered

    now = datetime.now(UTC)
    tomorrow = now + timedelta(days=1)
    sent = 0

    async with task_session() as db:
        rows = (
            (
                await db.execute(
                    select(LoanRecord)
                    .where(
                        LoanRecord.status.in_([LoanRecordStatus.ACTIVE, LoanRecordStatus.OVERDUE]),
                        LoanRecord.borrower_email.is_not(None),
                    )
                    .limit(500)
                )
            )
            .scalars()
            .all()
        )

        for record in rows:
            if not record.borrower_email:
                continue

            is_due_soon = (
                record.status == LoanRecordStatus.ACTIVE
                and record.due_at <= tomorrow
                and record.reminder_sent_count == 0
            )
            is_overdue_retry = (
                record.status == LoanRecordStatus.OVERDUE
                and record.reminder_sent_count < _MAX_REMINDERS
                and (
                    record.last_reminder_at is None
                    or (now - record.last_reminder_at).days >= _REMINDER_INTERVAL_DAYS
                )
            )

            if not (is_due_soon or is_overdue_retry):
                continue

            try:
                if is_due_soon:
                    subject = "【借用提醒】您的借用物品即將到期"
                    body = (
                        f"您好，{record.borrower_name}，\n\n"
                        f"您借用的物品（編號 {record.unit_id}）歸還期限為 "
                        f"{record.due_at.strftime('%Y/%m/%d')}，請記得如期歸還。\n\n謝謝！"
                    )
                else:
                    subject = "【借用催還】您的借用物品已逾期"
                    body = (
                        f"您好，{record.borrower_name}，\n\n"
                        f"您借用的物品（編號 {record.unit_id}）歸還期限 "
                        f"{record.due_at.strftime('%Y/%m/%d')} 已過期，請盡快歸還。\n\n謝謝！"
                    )

                html = render_email(
                    "generic",
                    {
                        "subject": subject,
                        "preview_text": body[:80],
                        "body_html": f"<p>{body.replace(chr(10), '<br>')}</p>",
                        "card_rows": [],
                        "cta_url": None,
                        "cta_label": None,
                        "buttons": [],
                        "blocks": [],
                        "banner_image_url": None,
                        "banner_image_alt": "",
                    },
                )
                enqueue_rendered([record.borrower_email], subject, html)

                record.reminder_sent_count += 1
                record.last_reminder_at = now
                sent += 1
            except Exception:
                logger.exception("send loan reminder failed for record %s", record.id)

        await db.commit()
    return {"sent": sent}


@celery_app.task(
    name="api.services.loan_tasks.scan_overdue_loans",
    bind=True,
    max_retries=2,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def scan_overdue_loans(self) -> dict:
    """每日 08:00：將過期 active 紀錄標為 overdue。"""
    return asyncio.run(_scan_overdue_async())


@celery_app.task(
    name="api.services.loan_tasks.send_loan_reminders",
    bind=True,
    max_retries=2,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def send_loan_reminders(self) -> dict:
    """每日 09:00：寄即將到期 / 逾期催還信。"""
    return asyncio.run(_send_reminders_async())
