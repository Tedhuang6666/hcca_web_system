"""活動 Discord 工作區整合測試。"""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.activity import Activity, ActivityStatus
from api.models.activity_discord import ActivityMember, ActivityRole, DiscordActivityWorkspace
from api.models.discord_account import DiscordAccountLink
from api.models.outbox import OutboxEvent
from api.models.user import User
from api.services.activity_discord import apply_workspace_result, enqueue_workspace_sync


async def test_workspace_sync_emits_complete_activity_contract(
    db_session: AsyncSession,
) -> None:
    user = User(email="activity-member@example.com", display_name="活動成員")
    activity = Activity(name="校慶", status=ActivityStatus.ACTIVE)
    db_session.add_all([user, activity])
    await db_session.flush()
    role = ActivityRole(
        activity_id=activity.id,
        key="media",
        name="宣傳組",
        create_private_channel=True,
    )
    workspace = DiscordActivityWorkspace(activity_id=activity.id, guild_id="guild-1")
    db_session.add_all([role, workspace])
    await db_session.flush()
    db_session.add_all(
        [
            ActivityMember(
                activity_id=activity.id,
                role_id=role.id,
                user_id=user.id,
                start_date=date.today(),
            ),
            DiscordAccountLink(
                user_id=user.id,
                discord_user_id="discord-user-1",
                is_active=True,
            ),
        ]
    )
    await db_session.flush()

    await enqueue_workspace_sync(db_session, workspace)

    event = await db_session.scalar(
        select(OutboxEvent).where(OutboxEvent.event_type == "discord.activity_workspace_sync")
    )
    assert event is not None
    assert event.payload["activity_name"] == "校慶"
    assert event.payload["roles"][0]["member_discord_user_ids"] == ["discord-user-1"]
    assert event.payload["roles"][0]["create_private_channel"] is True


async def test_workspace_result_updates_discord_resource_ids(
    db_session: AsyncSession,
) -> None:
    user = User(email="synced-member@example.com", display_name="同步成員")
    activity = Activity(name="舞會", status=ActivityStatus.ACTIVE)
    db_session.add_all([user, activity])
    await db_session.flush()
    role = ActivityRole(activity_id=activity.id, key="stage", name="舞台組")
    workspace = DiscordActivityWorkspace(activity_id=activity.id, guild_id="guild-2")
    db_session.add_all([role, workspace])
    await db_session.flush()
    db_session.add(
        ActivityMember(
            activity_id=activity.id,
            role_id=role.id,
            user_id=user.id,
            start_date=date.today(),
        )
    )
    await db_session.flush()

    await apply_workspace_result(
        db_session,
        str(workspace.id),
        success=True,
        error=None,
        result={
            "category_id": "category-1",
            "convener_role_id": "convener-role-1",
            "roles": [{"id": str(role.id), "discord_role_id": "activity-role-1"}],
        },
    )

    assert workspace.category_id == "category-1"
    assert role.discord_role_id == "activity-role-1"
    assert workspace.convener_role_id == "convener-role-1"
