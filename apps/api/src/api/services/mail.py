"""郵件服務 - Resend API + Celery 背景任務"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from api.core.celery_app import celery_app
from api.core.config import settings
from api.models.email_message import (
    EmailCampaignRecipient,
    EmailMessage,
    EmailRecipientStatus,
    EmailStatus,
)

logger = logging.getLogger(__name__)

RESEND_EMAILS_URL = "https://api.resend.com/emails"

# 重試退避排程（秒）：第 1 次失敗 1 分鐘後、第 2 次 5 分、第 3 次 15 分、第 4 次 1 小時，
# 超過後進入 dead-letter（status=DEAD，不再自動重試）。max_retries 由此長度決定。
EMAIL_RETRY_BACKOFF = [60, 300, 900, 3600]


def _format_from() -> str:
    if settings.MAIL_FROM_NAME:
        return f"{settings.MAIL_FROM_NAME} <{settings.MAIL_FROM}>"
    return settings.MAIL_FROM


async def _send_via_resend(
    to: list[str],
    subject: str,
    body: str,
    subtype: str = "html",
) -> str | None:
    if not settings.RESEND_API_KEY:
        raise RuntimeError("RESEND_API_KEY 未設定，無法寄送 Email")

    payload: dict[str, object] = {
        "from": _format_from(),
        "to": to,
        "subject": subject,
    }
    if subtype == "plain":
        payload["text"] = body
    else:
        payload["html"] = body

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            RESEND_EMAILS_URL,
            headers={
                "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    response.raise_for_status()
    data = response.json()
    message_id = data.get("id")
    return str(message_id) if message_id else None


async def _update_email_message_status(
    email_message_id: str | None,
    status: EmailStatus,
    *,
    error_detail: str | None = None,
    attempt_count: int | None = None,
    next_retry_at: datetime | None = None,
) -> None:
    if not email_message_id:
        return
    engine = create_async_engine(str(settings.DATABASE_URL))
    try:
        async with AsyncSession(engine) as session:
            msg = await session.get(EmailMessage, uuid.UUID(email_message_id))
            if msg is None:
                return
            msg.status = status
            msg.error_detail = error_detail
            if attempt_count is not None:
                msg.attempt_count = attempt_count
            # 非 RETRYING（終態或成功）時清掉下一次重試時間
            msg.next_retry_at = next_retry_at if status == EmailStatus.RETRYING else None
            await session.commit()
    finally:
        await engine.dispose()


async def _update_campaign_recipient_status(
    email_recipient_id: str | None,
    status: EmailRecipientStatus,
    *,
    provider_id: str | None = None,
    error_detail: str | None = None,
    attempt_count: int | None = None,
    next_retry_at: datetime | None = None,
) -> None:
    if not email_recipient_id:
        return
    engine = create_async_engine(str(settings.DATABASE_URL))
    try:
        async with AsyncSession(engine) as session:
            recipient = await session.get(EmailCampaignRecipient, uuid.UUID(email_recipient_id))
            if recipient is None:
                return
            recipient.status = status
            recipient.provider_id = provider_id
            recipient.error_detail = error_detail
            if attempt_count is not None:
                recipient.attempt_count = attempt_count
            recipient.next_retry_at = (
                next_retry_at if status == EmailRecipientStatus.RETRYING else None
            )
            if status == EmailRecipientStatus.SENT:
                recipient.sent_at = datetime.now(UTC)
            counts = (
                await session.execute(
                    select(EmailCampaignRecipient.status, func.count())
                    .where(EmailCampaignRecipient.message_id == recipient.message_id)
                    .group_by(EmailCampaignRecipient.status)
                )
            ).all()
            by_status = {str(row[0]): int(row[1]) for row in counts}
            # 仍在途中的收件人（待寄或退避重試中）→ 尚未到終態盤點時機
            in_flight = by_status.get(EmailRecipientStatus.QUEUED, 0) + by_status.get(
                EmailRecipientStatus.RETRYING, 0
            )
            sent = by_status.get(EmailRecipientStatus.SENT, 0)
            # FAILED 與 DEAD 皆計為終態失敗
            failed = by_status.get(EmailRecipientStatus.FAILED, 0) + by_status.get(
                EmailRecipientStatus.DEAD, 0
            )
            message = await session.get(EmailMessage, recipient.message_id)
            if message is not None and in_flight == 0:
                if failed == 0:
                    message.status = EmailStatus.SENT
                    message.error_detail = None
                elif sent == 0:
                    message.status = EmailStatus.FAILED
                    message.error_detail = f"全部收件人寄送失敗（{failed} 人）"
                else:
                    message.status = EmailStatus.PARTIAL
                    message.error_detail = f"部分寄送失敗：成功 {sent} 人、失敗 {failed} 人"
            await session.commit()
    finally:
        await engine.dispose()


# ── Celery Task（同步函式內用 asyncio.run 執行非同步郵件發送）────────────────


@celery_app.task(
    name="api.services.mail.send_email", bind=True, max_retries=len(EMAIL_RETRY_BACKOFF)
)
def send_email(
    self,  # noqa: ANN001
    to: list[str],
    subject: str,
    body: str,
    subtype: str = "html",
    email_message_id: str | None = None,
    email_recipient_id: str | None = None,
) -> dict[str, object]:
    """
    Celery 背景郵件發送任務。

    - bind=True：可透過 self 呼叫 retry()
    - 失敗依 EMAIL_RETRY_BACKOFF 退避重試（1m→5m→15m→1h），期間 status=RETRYING
      並記錄 attempt_count / next_retry_at；耗盡後標記 DEAD（dead-letter）。
    """
    attempt = self.request.retries + 1  # 本次嘗試（1-based）

    try:
        message_id = asyncio.run(_send_via_resend(to, subject, body, subtype))
        if email_recipient_id is not None:
            asyncio.run(
                _update_campaign_recipient_status(
                    email_recipient_id,
                    EmailRecipientStatus.SENT,
                    provider_id=message_id,
                    attempt_count=attempt,
                )
            )
        else:
            asyncio.run(
                _update_email_message_status(
                    email_message_id, EmailStatus.SENT, attempt_count=attempt
                )
            )
        logger.info("郵件已送出 to=%s subject=%s resend_id=%s", to, subject, message_id)
        return {"status": "sent", "to": to, "subject": subject, "provider_id": message_id}
    except Exception as exc:
        exhausted = self.request.retries >= self.max_retries
        err = str(exc)[:500]
        delay = EMAIL_RETRY_BACKOFF[min(self.request.retries, len(EMAIL_RETRY_BACKOFF) - 1)]
        next_retry_at = None if exhausted else datetime.now(UTC) + timedelta(seconds=delay)

        # 狀態回寫採 best-effort：DB 暫時不可用時不可吃掉下方的 self.retry，
        # 否則 task 會直接 crash 而不重試，郵件永遠卡在「寄送中」。
        try:
            if email_recipient_id is not None:
                asyncio.run(
                    _update_campaign_recipient_status(
                        email_recipient_id,
                        EmailRecipientStatus.DEAD if exhausted else EmailRecipientStatus.RETRYING,
                        error_detail=err,
                        attempt_count=attempt,
                        next_retry_at=next_retry_at,
                    )
                )
            else:
                asyncio.run(
                    _update_email_message_status(
                        email_message_id,
                        EmailStatus.DEAD if exhausted else EmailStatus.RETRYING,
                        error_detail=err,
                        attempt_count=attempt,
                        next_retry_at=next_retry_at,
                    )
                )
        except Exception:
            logger.exception("更新郵件狀態失敗（不影響重試）to=%s", to)

        if exhausted:
            # 進入 dead-letter：raise self.retry 會丟出 MaxRetriesExceededError，
            # 觸發 celery task_failure → Redis DLQ（見 celery_app._push_dead_letter）。
            logger.error("郵件重試耗盡進入 dead-letter to=%s: %s", to, exc)
        else:
            logger.warning(
                "郵件發送失敗，第 %d 次嘗試，%ds 後重試 to=%s: %s", attempt, delay, to, exc
            )
        raise self.retry(exc=exc, countdown=delay) from exc


# ── 輔助函式（FastAPI 路由層呼叫）────────────────────────────────────────────


def enqueue_email(
    to: str | list[str],
    subject: str,
    body: str,
    subtype: str = "html",
    email_message_id: str | None = None,
    email_recipient_id: str | None = None,
) -> str:
    """
    將郵件發送任務推入 Celery 佇列，立即回傳 task_id。

    Args:
        to: 收件人（單一字串或清單）
        subject: 郵件主旨
        body: 郵件內容（HTML 或純文字）
        subtype: "html" 或 "plain"

    Returns:
        Celery task_id 字串
    """
    recipients = [to] if isinstance(to, str) else to
    if email_message_id is None and email_recipient_id is None:
        result = send_email.delay(recipients, subject, body, subtype)
    else:
        result = send_email.delay(
            recipients,
            subject,
            body,
            subtype,
            email_message_id,
            email_recipient_id,
        )
    logger.info("郵件任務已排入佇列 task_id=%s", result.id)
    return result.id


async def send_email_now(
    to: str | list[str],
    subject: str,
    body: str,
    subtype: str = "html",
) -> None:
    """
    直接非同步發送郵件（不透過 Celery，適用於測試或緊急通知）。
    """
    recipients = [to] if isinstance(to, str) else to
    await _send_via_resend(recipients, subject, body, subtype)
