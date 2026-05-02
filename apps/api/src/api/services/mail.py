"""郵件服務 - FastAPI-Mail + Celery 背景任務"""

from __future__ import annotations

import asyncio
import logging

from fastapi_mail import ConnectionConfig, FastMail, MessageSchema, MessageType

from api.core.celery_app import celery_app
from api.core.config import settings

logger = logging.getLogger(__name__)

# ── FastMail 連線設定（延遲初始化，避免無 SMTP 設定時啟動失敗）─────────────

def _get_mail_config() -> ConnectionConfig:
    return ConnectionConfig(
        MAIL_USERNAME=settings.MAIL_USERNAME,
        MAIL_PASSWORD=settings.MAIL_PASSWORD,
        MAIL_FROM=settings.MAIL_FROM,
        MAIL_FROM_NAME=settings.MAIL_FROM_NAME,
        MAIL_PORT=settings.MAIL_PORT,
        MAIL_SERVER=settings.MAIL_SERVER,
        MAIL_STARTTLS=settings.MAIL_STARTTLS,
        MAIL_SSL_TLS=settings.MAIL_SSL_TLS,
        USE_CREDENTIALS=bool(settings.MAIL_USERNAME),
        VALIDATE_CERTS=True,
    )


# ── Celery Task（同步函式內用 asyncio.run 執行非同步郵件發送）────────────────

@celery_app.task(name="api.services.mail.send_email", bind=True, max_retries=3)
def send_email(
    self,  # noqa: ANN001
    to: list[str],
    subject: str,
    body: str,
    subtype: str = "html",
) -> dict[str, object]:
    """
    Celery 背景郵件發送任務。

    - bind=True：可透過 self 呼叫 retry()
    - max_retries=3：SMTP 失敗自動重試最多 3 次（指數退避）
    """
    async def _send() -> None:
        message = MessageSchema(
            subject=subject,
            recipients=to,
            body=body,
            subtype=MessageType.html if subtype == "html" else MessageType.plain,
        )
        fm = FastMail(_get_mail_config())
        await fm.send_message(message)

    try:
        asyncio.run(_send())
        logger.info("郵件已送出 to=%s subject=%s", to, subject)
        return {"status": "sent", "to": to, "subject": subject}
    except Exception as exc:
        logger.warning("郵件發送失敗，準備重試: %s", exc)
        raise self.retry(exc=exc, countdown=2 ** self.request.retries) from exc


# ── 輔助函式（FastAPI 路由層呼叫）────────────────────────────────────────────

def enqueue_email(
    to: str | list[str],
    subject: str,
    body: str,
    subtype: str = "html",
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
    result = send_email.delay(recipients, subject, body, subtype)
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
    message = MessageSchema(
        subject=subject,
        recipients=recipients,
        body=body,
        subtype=MessageType.html if subtype == "html" else MessageType.plain,
    )
    fm = FastMail(_get_mail_config())
    await fm.send_message(message)
