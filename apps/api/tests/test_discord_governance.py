from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from api.models.discord_account import DiscordRolePolicy
from api.models.governance import GovernanceDiscordEventRoute, GovernanceDiscordWorkspace, Matter
from api.models.outbox import OutboxEvent
from api.services.discord_governance import (
    compose_nickname,
    remove_applied_prefix,
    select_prefix_labels,
)
from api.services.governance_discord import emit_matter_event


def _policy(label: str | None, priority: int, *, active: bool = True) -> DiscordRolePolicy:
    return DiscordRolePolicy(
        id=uuid.uuid4(),
        guild_id="guild",
        role_id=str(uuid.uuid4().int),
        nickname_label=label,
        priority=priority,
        manage_role=True,
        use_in_nickname=True,
        is_active=active,
    )


def test_select_prefix_labels_uses_priority_deduplicates_and_limits_to_two():
    policies = [
        _policy("活動", 30),
        _policy("新聞長", 10),
        _policy("新聞長", 20),
        _policy("秘書長", 40),
        _policy("停用", 1, active=False),
    ]

    assert select_prefix_labels(policies) == ["新聞長", "活動"]


def test_compose_nickname_supports_zero_one_and_two_prefixes():
    assert compose_nickname([], "Ryder621") == ("Ryder621", None)
    assert compose_nickname(["新聞長"], "Ryder621") == ("新聞長｜Ryder621", "新聞長")
    assert compose_nickname(["新聞長", "活動"], "Ryder621") == (
        "新聞長&活動｜Ryder621",
        "新聞長&活動",
    )


def test_compose_nickname_removes_second_prefix_before_truncating_base_name():
    nickname, prefix = compose_nickname(["新聞長", "活動"], "Ryder621" * 5)

    assert prefix == "新聞長"
    assert nickname.startswith("新聞長｜")
    assert len(nickname) == 32


def test_remove_applied_prefix_preserves_user_edited_base_name():
    base = remove_applied_prefix("新聞長&活動｜新的自訂暱稱", "新聞長&活動")

    assert base == "新的自訂暱稱"
    assert compose_nickname(["秘書長"], base)[0] == "秘書長｜新的自訂暱稱"


@pytest.mark.parametrize("href", [None, "/announcements/current"])
async def test_existing_workspace_events_preserve_only_available_links(db_session, href):
    matter = Matter(title="校慶籌備", matter_type="activity")
    db_session.add(matter)
    await db_session.flush()
    workspace = GovernanceDiscordWorkspace(
        matter_id=matter.id,
        guild_id="guild",
        mode="existing",
        discussion_channel_id="discussion",
        is_active=True,
    )
    db_session.add(workspace)
    await db_session.flush()
    db_session.add(
        GovernanceDiscordEventRoute(
            workspace_id=workspace.id,
            event_type="announcement.*",
            channel_kind="discussion",
            is_active=True,
        )
    )
    await db_session.flush()

    await emit_matter_event(
        db_session,
        matter_id=matter.id,
        event_type="announcement.published",
        title="公告發布",
        body="測試公告",
        href=href,
    )

    event = await db_session.scalar(
        select(OutboxEvent).where(
            OutboxEvent.event_type == "discord.channel_alert",
        )
    )
    assert event is not None
    assert event.payload["channel_id"] == "discussion"
    assert event.payload["link"] == href
