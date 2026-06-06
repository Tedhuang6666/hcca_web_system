"""Feature Flag schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class FeatureFlagCreate(BaseModel):
    key: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z][a-z0-9_]*$")
    description: str | None = None


class FeatureFlagUpdate(BaseModel):
    description: str | None = None
    is_globally_enabled: bool | None = None
    percentage_rollout: int | None = Field(None, ge=0, le=100)
    enabled_user_ids: list[str] | None = None
    enabled_permission_codes: list[str] | None = None


class FeatureFlagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    key: str
    description: str | None
    is_globally_enabled: bool
    percentage_rollout: int
    enabled_user_ids: list[str]
    enabled_permission_codes: list[str]
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class FeatureFlagEvaluation(BaseModel):
    """`GET /feature-flags/me/{key}` 回傳：目前使用者是否啟用該 flag。"""

    key: str
    enabled: bool


__all__ = [
    "FeatureFlagCreate",
    "FeatureFlagEvaluation",
    "FeatureFlagOut",
    "FeatureFlagUpdate",
]
