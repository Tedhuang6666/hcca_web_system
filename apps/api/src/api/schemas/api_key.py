"""ApiKey schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ApiKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    scopes: list[str] = Field(default_factory=list, max_length=64)
    rate_limit_per_minute: int = Field(60, ge=1, le=10000)
    expires_at: datetime | None = None


class ApiKeyOut(BaseModel):
    """通用回傳；不含 key 明文。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    key_prefix: str
    owner_user_id: uuid.UUID
    scopes: list[str]
    rate_limit_per_minute: int
    expires_at: datetime | None
    last_used_at: datetime | None
    last_used_ip: str | None
    revoked_at: datetime | None
    revoked_reason: str | None
    is_active: bool
    created_at: datetime


class ApiKeyCreatedResponse(BaseModel):
    """建立成功的特殊回傳：含一次性明文 key。"""

    model_config = ConfigDict(from_attributes=True)

    api_key: ApiKeyOut
    key_plaintext: str = Field(
        ...,
        description="一次性顯示的完整 key。請立即妥善保存；之後無法再取得。",
    )


class ApiKeyRevoke(BaseModel):
    reason: str | None = Field(None, max_length=500)


__all__ = [
    "ApiKeyCreate",
    "ApiKeyCreatedResponse",
    "ApiKeyOut",
    "ApiKeyRevoke",
]
