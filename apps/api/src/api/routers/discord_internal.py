"""供獨立 Discord Bot instance 使用的內部 API。"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.api_key_auth import require_api_scope
from api.models.api_key import ApiKey
from api.schemas.discord_internal import (
    DiscordBotEventAck,
    DiscordBotEventOut,
    DiscordBotInventoryIn,
    DiscordBotStatusOut,
    DiscordCommandRequest,
    DiscordCommandResponse,
    DiscordMemberJoinedIn,
    DiscordMemberJoinedOut,
)
from api.services import discord_commands, discord_gateway

router = APIRouter(
    prefix="/internal/discord",
    tags=["Discord Bot Internal"],
)

DbDep = Annotated[AsyncSession, Depends(get_db)]
BotKeyDep = Annotated[ApiKey, Depends(require_api_scope("discord:bot"))]


@router.get("/status", response_model=DiscordBotStatusOut)
async def bot_status(_api_key: BotKeyDep) -> DiscordBotStatusOut:
    return DiscordBotStatusOut(status="ok", server_time=datetime.now(UTC))


@router.get("/events/claim", response_model=DiscordBotEventOut | None)
async def claim_event(
    db: DbDep,
    _api_key: BotKeyDep,
    wait_seconds: int = Query(20, ge=0, le=25),
) -> DiscordBotEventOut | Response:
    for attempt in range(wait_seconds + 1):
        claimed = await discord_gateway.claim_next_event(db)
        if claimed is not None:
            event, payload = claimed
            return DiscordBotEventOut(
                id=event.id,
                event_type=event.event_type,
                payload=payload,
            )
        if attempt < wait_seconds:
            await asyncio.sleep(1)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/events/{event_id}/ack", status_code=204)
async def acknowledge_event(
    event_id: uuid.UUID,
    body: DiscordBotEventAck,
    db: DbDep,
    _api_key: BotKeyDep,
) -> None:
    found = await discord_gateway.acknowledge_event(
        db,
        event_id,
        success=body.success,
        error=body.error,
        result=body.result,
    )
    if not found:
        raise HTTPException(status_code=404, detail="Discord outbox event 不存在")


@router.post("/members/joined", response_model=DiscordMemberJoinedOut)
async def member_joined(
    body: DiscordMemberJoinedIn,
    db: DbDep,
    _api_key: BotKeyDep,
) -> DiscordMemberJoinedOut:
    display_name = await discord_gateway.handle_member_joined(
        db,
        guild_id=body.guild_id,
        discord_user_id=body.discord_user_id,
        display_name=body.display_name,
    )
    return DiscordMemberJoinedOut(
        linked=display_name is not None,
        platform_display_name=display_name,
    )


@router.put("/inventory", status_code=204)
async def update_inventory(
    body: DiscordBotInventoryIn,
    _api_key: BotKeyDep,
) -> None:
    await discord_gateway.write_inventory(body.model_dump())


@router.post("/commands/{operation}", response_model=DiscordCommandResponse)
async def execute_command(
    operation: str,
    body: DiscordCommandRequest,
    db: DbDep,
    _api_key: BotKeyDep,
) -> DiscordCommandResponse:
    try:
        data = await discord_commands.execute(
            db,
            operation=operation,
            discord_user_id=body.discord_user_id,
            interaction_id=body.interaction_id,
            guild_id=body.guild_id,
            arguments=body.arguments,
        )
    except discord_commands.DiscordCommandError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return DiscordCommandResponse(data=data)


__all__ = ["router"]
