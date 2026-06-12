"""獨立 Discord Bot 與 API 間的內部契約。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DiscordBotEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_type: str
    payload: dict[str, Any]


class DiscordBotEventAck(BaseModel):
    success: bool
    error: str | None = Field(None, max_length=2000)
    result: dict[str, Any] = Field(default_factory=dict)


class DiscordMemberJoinedIn(BaseModel):
    guild_id: str = Field(..., min_length=1, max_length=32)
    discord_user_id: str = Field(..., min_length=1, max_length=32)
    display_name: str = Field(..., min_length=1, max_length=100)


class DiscordMemberJoinedOut(BaseModel):
    linked: bool
    platform_display_name: str | None = None


class DiscordCommandRequest(BaseModel):
    discord_user_id: str = Field(..., min_length=1, max_length=32)
    interaction_id: str = Field(..., min_length=1, max_length=32)
    guild_id: str | None = Field(None, max_length=32)
    arguments: dict[str, Any] = Field(default_factory=dict)


class DiscordCommandResponse(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


class DiscordBotInventoryIn(BaseModel):
    bot_user_id: str = Field(..., min_length=1, max_length=32)
    bot_username: str = Field(..., min_length=1, max_length=100)
    latency_ms: float = Field(..., ge=0)
    guilds: list[dict[str, Any]] = Field(default_factory=list)


class DiscordBotStatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    status: str
    server_time: datetime


__all__ = [
    "DiscordBotInventoryIn",
    "DiscordBotEventAck",
    "DiscordBotEventOut",
    "DiscordBotStatusOut",
    "DiscordCommandRequest",
    "DiscordCommandResponse",
    "DiscordMemberJoinedIn",
    "DiscordMemberJoinedOut",
]
