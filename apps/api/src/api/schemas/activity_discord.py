"""活動 Discord 整合 Schemas。"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from api.models.activity_discord import DiscordActivitySyncStatus


class ActivityRoleCreate(BaseModel):
    key: str = Field(..., min_length=1, max_length=60, pattern=r"^[a-z0-9_-]+$")
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    create_private_channel: bool = False
    sort_order: int = Field(100, ge=0, le=9999)


class ActivityRoleUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    create_private_channel: bool | None = None
    sort_order: int | None = Field(None, ge=0, le=9999)
    is_active: bool | None = None


class ActivityRoleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    activity_id: uuid.UUID
    key: str
    name: str
    description: str | None
    discord_role_id: str | None
    discord_channel_id: str | None
    create_private_channel: bool
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ActivityMemberCreate(BaseModel):
    role_id: uuid.UUID
    user_id: uuid.UUID
    start_date: date
    end_date: date | None = None

    @model_validator(mode="after")
    def validate_term(self) -> ActivityMemberCreate:
        if self.end_date and self.end_date < self.start_date:
            raise ValueError("活動職務任期結束日不可早於開始日")
        return self


class ActivityMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    activity_id: uuid.UUID
    role_id: uuid.UUID
    user_id: uuid.UUID
    start_date: date
    end_date: date | None
    role_name: str = ""
    user_name: str = ""
    user_email: str = ""
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="before")
    @classmethod
    def include_relations(cls, data: object) -> object:
        if isinstance(data, dict):
            return data
        role = getattr(data, "role", None)
        user = getattr(data, "user", None)
        return {
            "id": getattr(data, "id", None),
            "activity_id": getattr(data, "activity_id", None),
            "role_id": getattr(data, "role_id", None),
            "user_id": getattr(data, "user_id", None),
            "start_date": getattr(data, "start_date", None),
            "end_date": getattr(data, "end_date", None),
            "role_name": getattr(role, "name", "") if role else "",
            "user_name": getattr(user, "display_name", "") if user else "",
            "user_email": getattr(user, "email", "") if user else "",
            "created_at": getattr(data, "created_at", None),
            "updated_at": getattr(data, "updated_at", None),
        }


class DiscordActivityWorkspaceUpsert(BaseModel):
    guild_id: str = Field(..., min_length=1, max_length=32)
    category_id: str | None = Field(None, max_length=32)
    general_channel_id: str | None = Field(None, max_length=32)
    announcement_channel_id: str | None = Field(None, max_length=32)
    staff_channel_id: str | None = Field(None, max_length=32)
    convener_role_id: str | None = Field(None, max_length=32)
    auto_sync: bool = True
    is_active: bool = True


class DiscordActivityWorkspaceOut(DiscordActivityWorkspaceUpsert):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    activity_id: uuid.UUID
    sync_status: DiscordActivitySyncStatus
    last_error: str | None
    last_synced_at: datetime | None
    created_at: datetime
    updated_at: datetime
