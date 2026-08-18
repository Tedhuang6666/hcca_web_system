"""抽獎系統 API schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RafflePrizeCreate(BaseModel):
    tier: str = Field(..., min_length=1, max_length=2)
    name: str = Field(..., min_length=1, max_length=160)
    quantity: int | None = Field(..., ge=0)
    sort_order: int = 0


class RaffleCreate(BaseModel):
    event_code: str = Field(..., min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")
    title: str = Field(..., min_length=1, max_length=160)
    description: str | None = Field(None, max_length=1000)
    access_code: str = Field(..., min_length=4, max_length=32)
    prizes: list[RafflePrizeCreate] = Field(..., min_length=1, max_length=30)


class RaffleStatusUpdate(BaseModel):
    status: str = Field(..., pattern=r"^(draft|open|paused|closed)$")
    reserve_released: bool | None = None


class RafflePrizeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tier: str
    name: str
    total_quantity: int | None
    remaining_quantity: int | None
    sort_order: int


class RaffleDrawOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    draw_number: int
    prize_id: uuid.UUID
    prize_tier: str
    prize_name: str
    created_at: datetime


class RaffleEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_code: str
    title: str
    description: str | None
    status: str
    draw_count: int
    reserve_released: bool
    access_code_hint: str
    prizes: list[RafflePrizeOut]
    created_at: datetime
    updated_at: datetime


class RaffleJoinRequest(BaseModel):
    event_code: str = Field(..., min_length=3, max_length=32)
    access_code: str = Field(..., min_length=4, max_length=32)
    device_id: str | None = Field(None, max_length=120)


class RaffleJoinOut(BaseModel):
    session_token: str
    event: RaffleEventOut
    existing_draw: RaffleDrawOut | None = None


class RaffleDrawRequest(BaseModel):
    session_token: str = Field(..., min_length=20, max_length=200)
    idempotency_key: str = Field(..., min_length=8, max_length=80)


class RaffleAdminOut(RaffleEventOut):
    recent_draws: list[RaffleDrawOut] = Field(default_factory=list)


__all__ = [
    "RaffleAdminOut",
    "RaffleCreate",
    "RaffleDrawOut",
    "RaffleDrawRequest",
    "RaffleEventOut",
    "RaffleJoinOut",
    "RaffleJoinRequest",
    "RafflePrizeCreate",
    "RafflePrizeOut",
    "RaffleStatusUpdate",
]
