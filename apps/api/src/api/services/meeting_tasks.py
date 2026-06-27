"""議事系統 Celery 定時任務 - 開會時間將屆時推播提醒通知。"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from api.core.celery_app import celery_app

logger = logging.getLogger(__name__)

# 開會前多久發出提醒
REMINDER_LEAD = timedelta(minutes=30)
# 容忍 Beat 短暫停擺的回溯範圍（超過此範圍視為過期草稿，不再提醒）
REMINDER_LOOKBACK = timedelta(hours=1)
_TAIPEI = ZoneInfo("Asia/Taipei")


@celery_app.task(
    name="api.services.meeting_tasks.send_meeting_start_reminders",
    bind=True,
    max_retries=3,
)
def send_meeting_start_reminders(self) -> dict:  # noqa: ANN001
    """Celery Beat 定時任務：對開會時間將屆的已確認草稿會議推播站內提醒。

    每 60 秒執行一次；掃描 starts_at 落在「現在 + 30 分鐘」內、尚未提醒過的
    已確認草稿會議，向其出列席名冊推播站內通知。會議仍維持草稿狀態，
    依設定僅提醒、不自動開會，須由主席手動按「開始會議」。
    """

    async def _run() -> int:
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from api.core.database import task_session
        from api.models.meeting import Meeting, MeetingStatus
        from api.models.notification import Notification

        reminded = 0
        async with task_session() as session:
            try:
                now = datetime.now(UTC)
                meetings = (
                    (
                        await session.execute(
                            select(Meeting)
                            .options(selectinload(Meeting.attendance_records))
                            .where(
                                Meeting.status == MeetingStatus.DRAFT,
                                Meeting.confirmed_at.is_not(None),
                                Meeting.reminder_sent_at.is_(None),
                                Meeting.starts_at.is_not(None),
                                Meeting.starts_at <= now + REMINDER_LEAD,
                                Meeting.starts_at >= now - REMINDER_LOOKBACK,
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                for meeting in meetings:
                    when = meeting.starts_at.astimezone(_TAIPEI).strftime("%Y-%m-%d %H:%M")
                    body = (
                        f"「{meeting.title}」預定於 {when} 在 "
                        f"{meeting.location or '（地點未定）'} 召開，請準時出席。"
                    )
                    for record in meeting.attendance_records:
                        session.add(
                            Notification(
                                user_id=record.user_id,
                                type="meeting_reminder",
                                title=f"會議即將開始：{meeting.title}",
                                body=body,
                                link=f"/meetings/{meeting.id}",
                                related_id=meeting.id,
                            )
                        )
                    meeting.reminder_sent_at = now
                    reminded += 1
                await session.commit()
                return reminded
            except Exception:
                await session.rollback()
                raise

    try:
        count = asyncio.run(_run())
        logger.info("[Celery Beat] 開會提醒完成，共提醒 %d 場會議", count)
        return {"reminded": count}
    except Exception as exc:
        logger.error("[Celery Beat] 開會提醒失敗: %s", exc)
        raise self.retry(exc=exc, countdown=120) from exc
