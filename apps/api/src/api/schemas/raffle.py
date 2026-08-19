"""抽獎系統 API schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RafflePrizeInput(BaseModel):
    tier: str = Field(..., min_length=1, max_length=2)
    name: str = Field(..., min_length=1, max_length=160)
    total_quantity: int | None = Field(None, ge=0)


class RaffleActivate(BaseModel):
    """以驗證碼開啟抽獎，獎池可由管理員自訂。"""

    access_code: str = Field(..., min_length=4, max_length=32)
    prizes: list[RafflePrizeInput] | None = Field(None, min_length=1, max_length=50)


class RaffleStatusUpdate(BaseModel):
    status: str | None = Field(None, pattern=r"^(draft|open|paused|closed)$")
    reserve_released: bool | None = None
    prizes: list[RafflePrizeInput] | None = Field(None, min_length=1, max_length=50)


class RafflePrizeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tier: str
    name: str
    total_quantity: int | None
    remaining_quantity: int | None
    sort_order: int
    reserved_quantity: int = 0
    current_probability: float = 0


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
    title: str
    description: str | None
    status: str
    draw_count: int
    reserve_released: bool
    prizes: list[RafflePrizeOut]
    created_at: datetime
    updated_at: datetime


class RaffleJoinRequest(BaseModel):
    access_code: str = Field(..., min_length=4, max_length=32)
    device_id: str | None = Field(None, max_length=120)


class RaffleJoinOut(BaseModel):
    session_token: str
    event: RaffleEventOut
    existing_draw: RaffleDrawOut | None = None


class RaffleNextRequest(BaseModel):
    session_token: str = Field(..., min_length=20, max_length=200)


class RaffleNextOut(BaseModel):
    session_token: str
    event: RaffleEventOut


class RaffleDrawRequest(BaseModel):
    session_token: str = Field(..., min_length=20, max_length=200)
    idempotency_key: str = Field(..., min_length=8, max_length=80)


class RaffleAdminOut(RaffleEventOut):
    recent_draws: list[RaffleDrawOut] = Field(default_factory=list)


__all__ = [
    "RaffleAdminOut",
    "RaffleActivate",
    "RaffleDrawOut",
    "RaffleDrawRequest",
    "RaffleEventOut",
    "RaffleJoinOut",
    "RaffleJoinRequest",
    "RaffleNextOut",
    "RaffleNextRequest",
    "RafflePrizeInput",
    "RafflePrizeOut",
    "RaffleStatusUpdate",
]
