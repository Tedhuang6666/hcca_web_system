"""郵件服務 - Resend API + Celery 背景任務"""

from __future__ import annotations

import asyncio
import logging
import uuid

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from api.core.celery_app import celery_app
from api.core.config import settings
from api.models.email_message import EmailMessage, EmailStatus

logger = logging.getLogger(__name__)

RESEND_EMAILS_URL = "https://api.resend.com/emails"


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
            await session.commit()
    finally:
        await engine.dispose()


# ── Celery Task（同步函式內用 asyncio.run 執行非同步郵件發送）────────────────


@celery_app.task(name="api.services.mail.send_email", bind=True, max_retries=3)
def send_email(
    self,  # noqa: ANN001
    to: list[str],
    subject: str,
    body: str,
    subtype: str = "html",
    email_message_id: str | None = None,
) -> dict[str, object]:
    """
    Celery 背景郵件發送任務。

    - bind=True：可透過 self 呼叫 retry()
    - max_retries=3：Resend API 失敗自動重試最多 3 次（指數退避）
    """

    try:
        message_id = asyncio.run(_send_via_resend(to, subject, body, subtype))
        asyncio.run(_update_email_message_status(email_message_id, EmailStatus.SENT))
        logger.info("郵件已送出 to=%s subject=%s resend_id=%s", to, subject, message_id)
        return {"status": "sent", "to": to, "subject": subject, "provider_id": message_id}
    except Exception as exc:
        if self.request.retries >= self.max_retries:
            asyncio.run(
                _update_email_message_status(
                    email_message_id,
                    EmailStatus.FAILED,
                    error_detail=str(exc)[:500],
                )
            )
        logger.warning("郵件發送失敗，準備重試: %s", exc)
        raise self.retry(exc=exc, countdown=2**self.request.retries) from exc


# ── 輔助函式（FastAPI 路由層呼叫）────────────────────────────────────────────


def enqueue_email(
    to: str | list[str],
    subject: str,
    body: str,
    subtype: str = "html",
    email_message_id: str | None = None,
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
    if email_message_id is None:
        result = send_email.delay(recipients, subject, body, subtype)
    else:
        result = send_email.delay(recipients, subject, body, subtype, email_message_id)
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
