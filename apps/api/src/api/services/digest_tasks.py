"""Email 摘要 Celery tasks — 每日 / 每週把未讀通知聚合為單封 Email。

設計考量：
- 使用者偏好存於 User.notification_preferences JSONB 的 `__digest_frequency` 鍵
  （off / daily / weekly），不需新增 DB 欄位
- 只彙整「過去 N 小時內仍未讀」的通知，避免重複轟炸
- 若使用者該期間無未讀通知，不寄信
- Beat 排程：daily 每天 08:00、weekly 每週一 08:00（皆為 Asia/Taipei）
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from api.core.celery_app import celery_app
from api.core.database import task_session
from api.models.notification import Notification
from api.models.user import User
from api.services.mail import enqueue_email
from api.services.notification_pref import get_digest_frequency

logger = logging.getLogger(__name__)


def _render_digest_html(user: User, notifications: list[Notification]) -> str:
    """簡單純 HTML 模板。避免引入 Jinja 額外依賴。"""
    rows = []
    for n in notifications[:50]:
        title = (n.title or "通知").replace("<", "&lt;")
        body = (n.body or "").replace("<", "&lt;")
        link_html = ""
        if n.link:
            href = n.link.replace('"', "&quot;")
            link_html = f'<a href="{href}" style="color:#0284c7;text-decoration:none;">查看 →</a>'
        when = n.created_at.strftime("%m/%d %H:%M")
        rows.append(
            f"""
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;">
                <div style="font-size:14px;font-weight:600;color:#111;">{title}</div>
                <div style="font-size:12px;color:#555;margin-top:2px;">{body}</div>
                <div style="font-size:11px;color:#999;margin-top:4px;">{when} {link_html}</div>
              </td>
            </tr>
            """
        )
    name = (user.display_name or "您").replace("<", "&lt;")
    total = len(notifications)
    extra = (
        f"<p style='font-size:12px;color:#777;'>共有 {total} 則通知，僅顯示前 50 則。</p>"
        if total > 50
        else ""
    )
    return f"""
<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f7f7f9;font-family:-apple-system,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;
              box-shadow:0 1px 3px rgba(0,0,0,0.05);">
    <div style="padding:18px 20px;border-bottom:1px solid #eee;">
      <h1 style="margin:0;font-size:16px;color:#111;">HCCA 通知摘要</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#666;">嗨 {name}，您有 {total} 則未讀通知</p>
    </div>
    <table style="width:100%;border-collapse:collapse;">{"".join(rows)}</table>
    {extra}
    <div style="padding:14px 20px;border-top:1px solid #eee;font-size:11px;color:#999;">
      可至「設定 → 通知偏好」調整摘要頻率或關閉。
    </div>
  </div>
</body></html>
"""


async def _process_digest(frequency: str, window_hours: int) -> dict[str, int]:
    """掃描所有訂閱 frequency 的使用者，聚合未讀通知並寄信。"""
    cutoff = datetime.now(UTC) - timedelta(hours=window_hours)
    sent = 0
    skipped = 0

    async with task_session() as session:
        users_result = await session.execute(select(User).where(User.is_active.is_(True)))
        users = users_result.scalars().all()
        for user in users:
            if get_digest_frequency(user.notification_preferences) != frequency:
                continue
            ntfs_result = await session.execute(
                select(Notification)
                .where(Notification.user_id == user.id)
                .where(Notification.is_read.is_(False))
                .where(Notification.created_at >= cutoff)
                .order_by(Notification.created_at.desc())
            )
            ntfs = list(ntfs_result.scalars().all())
            if not ntfs:
                skipped += 1
                continue
            html = _render_digest_html(user, ntfs)
            subject = f"HCCA 通知摘要：{len(ntfs)} 則未讀"
            try:
                enqueue_email(to=user.email, subject=subject, body=html, subtype="html")
                sent += 1
            except Exception:
                logger.warning("digest enqueue failed for user=%s", user.id, exc_info=True)
    logger.info(
        "digest task done frequency=%s window=%dh sent=%d skipped=%d",
        frequency,
        window_hours,
        sent,
        skipped,
    )
    return {"sent": sent, "skipped": skipped}


@celery_app.task(name="api.services.digest_tasks.send_daily_digest", bind=True, max_retries=0)
def send_daily_digest(self) -> dict:  # noqa: ARG001
    """每日 08:00 聚合過去 24 小時未讀通知。"""
    return asyncio.run(_process_digest("daily", window_hours=24))


@celery_app.task(name="api.services.digest_tasks.send_weekly_digest", bind=True, max_retries=0)
def send_weekly_digest(self) -> dict:  # noqa: ARG001
    """每週一 08:00 聚合過去 7 天未讀通知。"""
    return asyncio.run(_process_digest("weekly", window_hours=24 * 7))
