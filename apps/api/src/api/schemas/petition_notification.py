"""陳情負責人通知設定 schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PetitionNotificationSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    enabled: bool
    recipient_user_ids: list[uuid.UUID]
    updated_at: datetime


class PetitionNotificationSettingsUpdate(BaseModel):
    enabled: bool = True
    recipient_user_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)


class PetitionNotificationRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    petition_type_id: uuid.UUID | None
    org_id: uuid.UUID | None
    enabled: bool
    recipient_user_ids: list[uuid.UUID]
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PetitionNotificationRuleCreate(BaseModel):
    petition_type_id: uuid.UUID | None = None
    org_id: uuid.UUID | None = None
    enabled: bool = True
    recipient_user_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def has_one_scope(self) -> PetitionNotificationRuleCreate:
        if (self.petition_type_id is None) == (self.org_id is None):
            raise ValueError("通知規則必須指定一個陳情類型或負責機關")
        return self


class PetitionNotificationRuleUpdate(BaseModel):
    enabled: bool | None = None
    recipient_user_ids: list[uuid.UUID] | None = Field(None, max_length=100)
    is_active: bool | None = None
