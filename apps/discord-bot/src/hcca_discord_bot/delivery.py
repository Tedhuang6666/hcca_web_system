"""Execute Discord outbox events through discord.py."""

from __future__ import annotations

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
    else:
        raise ValueError(f"Unsupported Discord event type: {event_type}")
    return {}
