"""Execute Discord outbox events through discord.py."""

from __future__ import annotations

import re
from typing import Any

import discord

from hcca_discord_bot.config import settings


def _embed(payload: dict[str, Any]) -> discord.Embed | None:
    raw = payload.get("embed")
    if isinstance(raw, dict):
        return discord.Embed.from_dict(raw)
    title = str(payload.get("title") or "HCCA 平台通知")
    body = payload.get("body")
    link = payload.get("link")
    if link:
        href = str(link)
        if not href.startswith(("http://", "https://")):
            href = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/{href.lstrip('/')}"
        body = f"{body}\n{href}" if body else href
    return discord.Embed(title=title, description=str(body) if body else None)


def _view(components: Any) -> discord.ui.View | None:
    if not isinstance(components, list) or not components:
        return None
    rows = components
    if rows and isinstance(rows[0], dict) and "components" in rows[0]:
        rows = [item for row in rows for item in row.get("components", [])]
    view = discord.ui.View(timeout=None)
    for item in rows[:5]:
        if not isinstance(item, dict) or not item.get("url"):
            continue
        view.add_item(
            discord.ui.Button(
                label=str(item.get("label") or "開啟平台")[:80],
                url=str(item["url"]),
            )
        )
    return view if view.children else None


async def _channel(client: discord.Client, channel_id: str) -> discord.abc.Messageable:
    channel = client.get_channel(int(channel_id))
    if channel is None:
        channel = await client.fetch_channel(int(channel_id))
    if not isinstance(channel, discord.abc.Messageable):
        raise TypeError(f"Discord channel {channel_id} cannot receive messages")
    return channel


async def _send_dm(client: discord.Client, payload: dict[str, Any]) -> None:
    discord_user_id = payload.get("discord_user_id")
    if not discord_user_id:
        raise ValueError("discord_user_id is required")
    user = client.get_user(int(discord_user_id)) or await client.fetch_user(int(discord_user_id))
    await user.send(
        embed=_embed(payload),
        view=_view(payload.get("components")),
    )


async def _send_channel(client: discord.Client, payload: dict[str, Any]) -> None:
    channel = await _channel(client, str(payload["channel_id"]))
    message = await channel.send(
        embed=_embed(payload),
        view=_view(payload.get("components")),
    )
    thread_name = payload.get("thread_name")
    if thread_name and isinstance(message, discord.Message):
        await message.create_thread(name=str(thread_name)[:100])


async def _sync_roles(client: discord.Client, payload: dict[str, Any]) -> None:
    guild = client.get_guild(int(payload["guild_id"]))
    if guild is None:
        guild = await client.fetch_guild(int(payload["guild_id"]))
    member = guild.get_member(int(payload["discord_user_id"]))
    if member is None:
        member = await guild.fetch_member(int(payload["discord_user_id"]))

    desired_ids = {int(value) for value in payload.get("role_ids", [])}
    managed_ids = {int(value) for value in payload.get("managed_role_ids", [])}
    current_ids = {role.id for role in member.roles}
    add_roles = [guild.get_role(role_id) for role_id in desired_ids - current_ids]
    remove_roles = [
        guild.get_role(role_id) for role_id in (managed_ids & current_ids) - desired_ids
    ]
    if roles := [role for role in add_roles if role is not None]:
        await member.add_roles(*roles, reason="HCCA platform role sync")
    if roles := [role for role in remove_roles if role is not None]:
        await member.remove_roles(*roles, reason="HCCA platform role sync")

    prefix = payload.get("nickname_prefix")
    managed_prefixes = tuple(str(value) for value in payload.get("managed_nickname_prefixes", []))
    base_name = member.display_name
    for managed_prefix in managed_prefixes:
        marker = f"{managed_prefix} "
        if base_name.startswith(marker):
            base_name = base_name[len(marker) :]
            break
    desired_nick = f"{prefix} {base_name}"[:32] if prefix else base_name[:32]
    if desired_nick != member.display_name:
        await member.edit(nick=desired_nick, reason="HCCA platform nickname sync")


async def _create_petition_channel(
    client: discord.Client, payload: dict[str, Any]
) -> dict[str, Any]:
    guild = client.get_guild(int(payload["guild_id"]))
    if guild is None:
        raise LookupError(f"Discord guild {payload['guild_id']} is unavailable")
    staff_role = guild.get_role(int(payload["staff_role_id"]))
    if staff_role is None:
        raise LookupError("Petition staff role is unavailable")

    overwrites: dict[discord.Role | discord.Member, discord.PermissionOverwrite] = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        staff_role: discord.PermissionOverwrite(
            view_channel=True,
            send_messages=True,
            manage_messages=True,
            attach_files=True,
            read_message_history=True,
        ),
    }
    submitter_id = payload.get("submitter_discord_user_id")
    if submitter_id:
        member = guild.get_member(int(submitter_id)) or await guild.fetch_member(int(submitter_id))
        overwrites[member] = discord.PermissionOverwrite(
            view_channel=True,
            send_messages=True,
            attach_files=True,
            read_message_history=True,
        )

    category = None
    if payload.get("category_id"):
        candidate = guild.get_channel(int(payload["category_id"]))
        if isinstance(candidate, discord.CategoryChannel):
            category = candidate
    case_number = str(payload.get("case_number") or str(payload["case_id"])[:8])
    title = str(payload.get("title") or "petition")
    safe_title = "".join(char if char.isalnum() else "-" for char in title.lower()).strip("-")
    channel = await guild.create_text_channel(
        name=f"petition-{case_number}-{safe_title[:24]}"[:100],
        topic=f"HCCA 陳情案件 {case_number}。正式長文與附件請回平台處理。",
        category=category,
        overwrites=overwrites,
        reason="HCCA platform petition channel",
    )
    mention = f"<@{submitter_id}> " if submitter_id else ""
    await channel.send(
        f"陳情案件 {case_number} 已建立私密討論頻道。\n"
        f"案件：{title}\n{mention}"
        "這裡適合快速補充與溝通；正式回覆、附件與結案仍會保存到平台。"
    )
    return {"guild_id": str(guild.id), "channel_id": str(channel.id)}


def _safe_channel_name(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", value.lower()).strip("-")
    return normalized[:90] or "activity"


async def _activity_workspace_sync(
    client: discord.Client, payload: dict[str, Any]
) -> dict[str, Any]:
    guild = client.get_guild(int(payload["guild_id"]))
    if guild is None:
        raise LookupError(f"Discord guild {payload['guild_id']} is unavailable")

    activity_name = str(payload.get("activity_name") or "活動")
    archived = bool(payload.get("archive"))
    category = None
    if payload.get("category_id"):
        candidate = guild.get_channel(int(payload["category_id"]))
        if isinstance(candidate, discord.CategoryChannel):
            category = candidate

    convener_role = None
    if payload.get("convener_role_id"):
        convener_role = guild.get_role(int(payload["convener_role_id"]))
    if convener_role is None:
        convener_role = await guild.create_role(
            name=f"{activity_name}｜總召"[:100],
            mentionable=True,
            reason="HCCA activity workspace sync",
        )

    role_results: list[dict[str, Any]] = []
    activity_roles: list[tuple[dict[str, Any], discord.Role]] = []
    for item in payload.get("roles", []):
        role = guild.get_role(int(item["discord_role_id"])) if item.get("discord_role_id") else None
        if role is None:
            role = await guild.create_role(
                name=f"{activity_name}｜{item['name']}"[:100],
                mentionable=True,
                reason="HCCA activity workspace sync",
            )
        elif role.name != f"{activity_name}｜{item['name']}"[:100]:
            await role.edit(
                name=f"{activity_name}｜{item['name']}"[:100],
                reason="HCCA activity workspace sync",
            )
        activity_roles.append((item, role))

    overwrites: dict[discord.Role | discord.Member, discord.PermissionOverwrite] = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        convener_role: discord.PermissionOverwrite(
            view_channel=True,
            send_messages=not archived,
            manage_messages=not archived,
            read_message_history=True,
        ),
    }
    for _item, role in activity_roles:
        overwrites[role] = discord.PermissionOverwrite(
            view_channel=True,
            send_messages=not archived,
            read_message_history=True,
        )

    category_name = f"{'已封存｜' if archived else ''}{activity_name}"[:100]
    if category is None:
        category = await guild.create_category(
            category_name,
            overwrites=overwrites,
            reason="HCCA activity workspace sync",
        )
    else:
        await category.edit(
            name=category_name,
            overwrites=overwrites,
            reason="HCCA activity workspace sync",
        )

    async def ensure_text_channel(
        channel_id: str | None,
        name: str,
        channel_overwrites: dict[discord.Role | discord.Member, discord.PermissionOverwrite],
    ) -> discord.TextChannel:
        channel = guild.get_channel(int(channel_id)) if channel_id else None
        if not isinstance(channel, discord.TextChannel):
            return await guild.create_text_channel(
                name=name,
                category=category,
                overwrites=channel_overwrites,
                reason="HCCA activity workspace sync",
            )
        await channel.edit(
            category=category,
            overwrites=channel_overwrites,
            reason="HCCA activity workspace sync",
        )
        return channel

    general = await ensure_text_channel(
        payload.get("general_channel_id"),
        "一般討論",
        overwrites,
    )
    announcement = await ensure_text_channel(
        payload.get("announcement_channel_id"),
        "活動公告",
        overwrites,
    )
    staff_overwrites = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        convener_role: discord.PermissionOverwrite(
            view_channel=True,
            send_messages=not archived,
            manage_messages=not archived,
            read_message_history=True,
        ),
    }
    staff = await ensure_text_channel(
        payload.get("staff_channel_id"),
        "核心工作區",
        staff_overwrites,
    )

    desired_by_role: dict[int, set[int]] = {
        convener_role.id: {int(value) for value in payload.get("convener_discord_user_ids", [])}
    }
    for item, role in activity_roles:
        desired_by_role[role.id] = {int(value) for value in item.get("member_discord_user_ids", [])}
        role_channel = None
        if item.get("create_private_channel"):
            role_overwrites = {
                guild.default_role: discord.PermissionOverwrite(view_channel=False),
                convener_role: discord.PermissionOverwrite(
                    view_channel=True,
                    send_messages=not archived,
                    read_message_history=True,
                ),
                role: discord.PermissionOverwrite(
                    view_channel=True,
                    send_messages=not archived,
                    read_message_history=True,
                ),
            }
            role_channel = await ensure_text_channel(
                item.get("discord_channel_id"),
                _safe_channel_name(str(item["name"])),
                role_overwrites,
            )
        role_results.append(
            {
                "id": str(item["id"]),
                "discord_role_id": str(role.id),
                "discord_channel_id": str(role_channel.id) if role_channel else None,
            }
        )

    for role_id, desired_member_ids in desired_by_role.items():
        role = guild.get_role(role_id)
        if role is None:
            continue
        for member in list(role.members):
            if member.id not in desired_member_ids:
                await member.remove_roles(role, reason="HCCA activity workspace sync")
        for member_id in desired_member_ids:
            member = guild.get_member(member_id) or await guild.fetch_member(member_id)
            if role not in member.roles:
                await member.add_roles(role, reason="HCCA activity workspace sync")

    return {
        "guild_id": str(guild.id),
        "category_id": str(category.id),
        "general_channel_id": str(general.id),
        "announcement_channel_id": str(announcement.id),
        "staff_channel_id": str(staff.id),
        "convener_role_id": str(convener_role.id),
        "roles": role_results,
        "archived": archived,
    }


async def dispatch(
    client: discord.Client,
    event_type: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if event_type in {"discord.push", "discord.user_dm"}:
        await _send_dm(client, payload)
    elif event_type in {"discord.channel_alert", "discord.embed_alert"}:
        await _send_channel(client, payload)
    elif event_type == "discord.role_sync":
        await _sync_roles(client, payload)
    elif event_type == "discord.petition_channel_create":
        return await _create_petition_channel(client, payload)
    elif event_type == "discord.activity_workspace_sync":
        return await _activity_workspace_sync(client, payload)
    else:
        raise ValueError(f"Unsupported Discord event type: {event_type}")
    return {}
