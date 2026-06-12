from __future__ import annotations

import uuid

from api.models.discord_account import DiscordRolePolicy
from api.models.governance import Matter
from api.services.discord_governance import (
    compose_nickname,
    remove_applied_prefix,
    select_prefix_labels,
)
from api.services.governance_discord import upsert_route, upsert_workspace


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


async def test_governance_workspace_supports_existing_and_managed_modes(db_session):
    matter = Matter(title="校慶籌備", matter_type="activity")
    db_session.add(matter)
    await db_session.flush()

    workspace = await upsert_workspace(
        db_session,
        matter,
        {
            "guild_id": "guild",
            "mode": "existing",
            "category_id": "category",
            "discussion_channel_id": "discussion",
            "announcement_channel_id": "announcement",
            "staff_channel_id": "staff",
            "mention_role_id": "role",
            "auto_sync": True,
            "is_active": True,
        },
    )
    route = await upsert_route(
        db_session,
        workspace,
        {
            "event_type": "meeting.*",
            "channel_kind": "discussion",
            "channel_id": None,
            "create_thread": True,
            "mention_role_id": "role",
            "is_active": True,
        },
    )

    assert workspace.mode == "existing"
    assert workspace.discussion_channel_id == "discussion"
    assert route.event_type == "meeting.*"

    managed = await upsert_workspace(
        db_session,
        matter,
        {
            "guild_id": "guild",
            "mode": "managed",
            "category_id": None,
            "discussion_channel_id": None,
            "announcement_channel_id": None,
            "staff_channel_id": None,
            "mention_role_id": "role",
            "auto_sync": True,
            "is_active": True,
        },
    )

    assert managed.id == workspace.id
    assert managed.mode == "managed"
