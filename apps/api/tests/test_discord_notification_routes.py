"""可配置 Discord 模組路由與個人 Discord 通知偏好測試。"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.discord_account import DiscordAccountLink
from api.models.discord_notification_route import DiscordNotificationRoute
from api.models.outbox import OutboxEvent
from api.services.discord_notification_routes import emit_routed_notification


async def test_emit_routed_notification_matches_event_and_filter(db_session: AsyncSession) -> None:
    db_session.add(
        DiscordNotificationRoute(
            guild_id="guild-1",
            event_key="merchandise_submission.submitted",
            module="shop",
            channel_id="channel-design",
            priority=10,
        )
    )
    await db_session.flush()

    sent = await emit_routed_notification(
        db_session,
        event_key="merchandise_submission.submitted",
        module="shop",
        title="新投稿",
        body="請設計部審閱",
        link="/merchandise-submissions",
    )

    assert sent == 1
    event = await db_session.scalar(
        select(OutboxEvent).where(OutboxEvent.event_type == "discord.channel_alert")
    )
    assert event is not None
    assert event.payload["channel_id"] == "channel-design"
    assert event.payload["event_key"] == "merchandise_submission.submitted"


async def test_personal_notification_uses_user_discord_preference(
    db_session: AsyncSession, make_user
) -> None:
    from api.routers.notifications import create_notification

    user = await make_user(
        notification_preferences={
            "document_pending": {
                "inapp": False,
                "email": False,
                "line": False,
                "discord": True,
            }
        }
    )
    db_session.add(
        DiscordAccountLink(
            user_id=user.id,
            discord_user_id=f"discord-{uuid.uuid4().hex[:8]}",
            is_active=True,
        )
    )
    await db_session.flush()

    await create_notification(
        db_session,
        user_id=user.id,
        type="document_pending",
        title="待核稿公文",
        body="請處理",
        link="/documents/1",
    )

    event = await db_session.scalar(
        select(OutboxEvent).where(OutboxEvent.event_type == "discord.user_dm")
    )
    assert event is not None
    assert event.payload["category"] == "document_pending"
