"""Discord 個人化提醒與 digest 任務（Celery beat）。

排程：
- discord_daily_digest：每日 08:00 台北
- discord_weekly_digest：週日 20:00 台北
- discord_reminder_sweep：每 15 分鐘掃描即將截止項目

備註：所有 task 都是同步函式（Celery worker 不在 asyncio loop），
事件透過 outbox.emit 寫入後由 process_pending_outbox 派發。
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from api.core.celery_app import celery_app
from api.core.config import settings
from api.models.calendar import CalendarEvent, CalendarEventParticipant
from api.models.discord_account import DiscordAccountLink, DiscordNotificationPreference
from api.models.meeting import Meeting, MeetingStatus
from api.models.outbox import OutboxEvent, OutboxStatus
from api.services.discord_embeds import Domain, Severity, build_embed, default_action_row

logger = logging.getLogger(__name__)


def _sync_engine():
    sync_url = str(settings.DATABASE_URL).replace("+asyncpg", "")
    return create_engine(sync_url)


def _enqueue_user_dm(
    session: Session,
    *,
    user_id: uuid.UUID,
    embed: dict,
    components: list[dict] | None = None,
    category: str | None = None,
) -> None:
    session.add(
        OutboxEvent(
            event_type="discord.user_dm",
            payload={
                "user_id": str(user_id),
                "embed": embed,
                "components": components,
                "category": category,
            },
            status=OutboxStatus.PENDING,
            created_at=datetime.now(UTC),
        )
    )


def _digest_eligible_users(session: Session, *, weekly: bool) -> list[tuple[uuid.UUID, str]]:
    """回傳 (user_id, discord_user_id) 清單；篩選綁定 + 對應 digest 開啟者。"""
    rows = session.execute(
        select(DiscordAccountLink.user_id, DiscordAccountLink.discord_user_id).where(
            DiscordAccountLink.is_active.is_(True)
        )
    ).all()
    if not rows:
        return []
    pref_rows = session.execute(select(DiscordNotificationPreference)).all()
    pref_by_user = {row[0].user_id: row[0] for row in pref_rows}
    eligible: list[tuple[uuid.UUID, str]] = []
    for user_id, discord_user_id in rows:
        pref = pref_by_user.get(user_id)
        # 未建 preference 視為 daily 開、weekly 關
        if weekly:
            enabled = bool(pref and pref.digest_weekly_enabled)
        else:
            enabled = pref is None or pref.digest_daily_enabled
        if enabled:
            eligible.append((user_id, discord_user_id))
    return eligible


def _build_digest_embed(
    *,
    weekly: bool,
    pending_meetings: int,
    closing_meals: int,
    closing_surveys: int,
    pending_documents: int,
) -> dict:
    period_label = "本週" if weekly else "今日"
    return build_embed(
        Domain.SYSTEM,
        Severity.INFO,
        title=f"HCCA {period_label}摘要",
        body="這是你的個人 HCCA 摘要；用 `/notify` 可關閉。",
        fields=[
            {"name": "公文待核", "value": str(pending_documents), "inline": True},
            {"name": f"{period_label}會議", "value": str(pending_meetings), "inline": True},
            {"name": "即將結單學餐", "value": str(closing_meals), "inline": True},
            {"name": "即將截止問卷", "value": str(closing_surveys), "inline": True},
        ],
    )


def _count_user_summary(
    session: Session, *, user_id: uuid.UUID, since: datetime, until: datetime
) -> dict[str, int]:
    """計算單一 user 在 [since, until) 區間的摘要數字。"""
    pending_meetings = session.execute(
        select(Meeting)
        .where(Meeting.starts_at.is_not(None))
        .where(Meeting.starts_at >= since)
        .where(Meeting.starts_at < until)
        .where(
            Meeting.status.in_(
                [MeetingStatus.DRAFT, MeetingStatus.CONFIRMED, MeetingStatus.ACTIVE]
            )
        )
    ).all()
    # TODO: 公文 / 學餐 / 問卷的個人化過濾留 Phase 2 dashboard 上線後串接 task_inbox。
    # 目前先給出 0，避免錯誤統計；之後在此填入真實查詢。
    return {
        "pending_meetings": len(pending_meetings),
        "closing_meals": 0,
        "closing_surveys": 0,
        "pending_documents": 0,
    }


@celery_app.task(name="api.services.discord_reminders.send_daily_digest")
def send_daily_digest() -> dict[str, int]:
    """每日 08:00 推播個人摘要 DM。"""
    sent = 0
    skipped = 0
    eng = _sync_engine()
    now = datetime.now(UTC)
    horizon = now + timedelta(days=1)
    with Session(eng) as session:
        users = _digest_eligible_users(session, weekly=False)
        for user_id, _discord_user_id in users:
            counts = _count_user_summary(session, user_id=user_id, since=now, until=horizon)
            if sum(counts.values()) == 0:
                skipped += 1
                continue
            embed = _build_digest_embed(weekly=False, **counts)
            components = default_action_row(open_url="/dashboard")
            _enqueue_user_dm(
                session,
                user_id=user_id,
                embed=embed,
                components=[components] if components else None,
                category=None,  # digest 不受 category 開關影響
            )
            sent += 1
        session.commit()
    logger.info("Discord daily digest sent=%d skipped=%d", sent, skipped)
    return {"sent": sent, "skipped": skipped}


@celery_app.task(name="api.services.discord_reminders.send_weekly_digest")
def send_weekly_digest() -> dict[str, int]:
    """每週日 20:00 推播本週摘要 DM。"""
    sent = 0
    skipped = 0
    eng = _sync_engine()
    now = datetime.now(UTC)
    horizon = now + timedelta(days=7)
    with Session(eng) as session:
        users = _digest_eligible_users(session, weekly=True)
        for user_id, _discord_user_id in users:
            counts = _count_user_summary(session, user_id=user_id, since=now, until=horizon)
            if sum(counts.values()) == 0:
                skipped += 1
                continue
            embed = _build_digest_embed(weekly=True, **counts)
            components = default_action_row(open_url="/dashboard")
            _enqueue_user_dm(
                session,
                user_id=user_id,
                embed=embed,
                components=[components] if components else None,
                category=None,
            )
            sent += 1
        session.commit()
    logger.info("Discord weekly digest sent=%d skipped=%d", sent, skipped)
    return {"sent": sent, "skipped": skipped}


@celery_app.task(name="api.services.discord_reminders.reminder_sweep")
def reminder_sweep() -> dict[str, int]:
    """每 15 分鐘掃描行事曆 T-24h / T-1h 提醒。

    其他模組（學餐、問卷、會議）已有自己的提醒 Celery task；本 sweep 專門
    處理 calendar events 的個人化推播。
    """
    eng = _sync_engine()
    now = datetime.now(UTC)
    one_hour = now + timedelta(hours=1)
    one_day = now + timedelta(hours=24)
    reminded = 0
    with Session(eng) as session:
        # 找在 1 小時內或 24 小時內開始的活動
        events = (
            session.execute(
                select(CalendarEvent)
                .where(CalendarEvent.starts_at >= now)
                .where(CalendarEvent.starts_at <= one_day)
                .where(CalendarEvent.is_active.is_(True))
            )
            .scalars()
            .all()
        )
        for event in events:
            lead = "1 小時內" if event.starts_at <= one_hour else "明日"
            # 取出參與者
            participant_ids = (
                session.execute(
                    select(CalendarEventParticipant.user_id).where(
                        CalendarEventParticipant.event_id == event.id
                    )
                )
                .scalars()
                .all()
            )
            for user_id in participant_ids:
                embed = build_embed(
                    Domain.CALENDAR,
                    Severity.WARNING,
                    title=f"行事曆提醒（{lead}）：{event.title}",
                    body=event.description,
                    fields=[
                        {
                            "name": "開始時間",
                            "value": event.starts_at.strftime("%Y-%m-%d %H:%M UTC"),
                            "inline": True,
                        },
                        {
                            "name": "地點",
                            "value": event.location or "—",
                            "inline": True,
                        },
                    ],
                    link=event.href or f"/calendar/events/{event.id}",
                )
                components = default_action_row(
                    open_url=event.href or f"/calendar/events/{event.id}",
                    domain=Domain.CALENDAR,
                )
                _enqueue_user_dm(
                    session,
                    user_id=user_id,
                    embed=embed,
                    components=[components] if components else None,
                    category="calendar_reminder",
                )
                reminded += 1
        session.commit()
    logger.info("Discord reminder sweep enqueued=%d", reminded)
    return {"reminded": reminded}


__all__ = [
    "reminder_sweep",
    "send_daily_digest",
    "send_weekly_digest",
]
