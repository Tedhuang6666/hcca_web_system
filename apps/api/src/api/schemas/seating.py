"""劃位系統 Pydantic Schemas - 場次 / 座位 / 分批時段 / 保留鎖 / 劃位"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from api.models.seating import SeatAssignmentStatus, SeatStatus

# ── 座位 ─────────────────────────────────────────────────────────────────────


class SeatInput(BaseModel):
    """座位圖編輯器送出的單一座位（含 id 則視為更新，無 id 則新增）。"""

    id: uuid.UUID | None = None
    label: str = Field(..., min_length=1, max_length=40, description="座位代號，如 A12")
    block: str | None = Field(None, max_length=80)
    row_label: str | None = Field(None, max_length=20)
    x: int = 0
    y: int = 0
    seat_type: str = Field("normal", max_length=40)
    price_delta: int = 0
    status: SeatStatus = SeatStatus.AVAILABLE


class SeatOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    zone_id: uuid.UUID
    label: str
    block: str | None = None
    row_label: str | None = None
    x: int
    y: int
    seat_type: str
    price_delta: int
    status: SeatStatus


# ── 分批開放時段 ──────────────────────────────────────────────────────────────


class WaveInput(BaseModel):
    id: uuid.UUID | None = None
    name: str = Field(..., min_length=1, max_length=200)
    starts_at: datetime | None = None
    audience: dict = Field(
        default_factory=dict, description="對象條件（targeting 結構）；空=所有人"
    )
    sort_order: int = 0


class WaveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    zone_id: uuid.UUID
    name: str
    starts_at: datetime | None = None
    audience: dict = {}
    sort_order: int


# ── 場次（座位圖）─────────────────────────────────────────────────────────────


class ZoneCreate(BaseModel):
    product_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    starts_at: datetime | None = None
    seating_opens_at: datetime | None = None
    hold_minutes: int = Field(10, ge=1, le=120)
    layout: dict = Field(default_factory=dict)
    sort_order: int = 0


class ZoneUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    starts_at: datetime | None = None
    seating_opens_at: datetime | None = None
    hold_minutes: int | None = Field(None, ge=1, le=120)
    layout: dict | None = None
    sort_order: int | None = None


class ZoneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    product_id: uuid.UUID
    name: str
    description: str | None = None
    starts_at: datetime | None = None
    seating_opens_at: datetime | None = None
    hold_minutes: int
    layout: dict = {}
    sort_order: int
    seats: list[SeatOut] = []
    waves: list[WaveOut] = []


class ZoneListItem(BaseModel):
    """場次列表精簡項（含座位統計）。"""

    id: uuid.UUID
    product_id: uuid.UUID
    name: str
    starts_at: datetime | None = None
    seating_opens_at: datetime | None = None
    sort_order: int
    seat_count: int = 0
    available_count: int = 0
    assigned_count: int = 0


# ── 座位圖批次儲存（編輯器）─────────────────────────────────────────────────────


class SeatsReplace(BaseModel):
    """以編輯器目前的座位集合覆蓋整張座位圖（保留已存在的 id）。"""

    layout: dict | None = None
    seats: list[SeatInput] = Field(default_factory=list)


class WavesReplace(BaseModel):
    waves: list[WaveInput] = Field(default_factory=list)


# ── 使用者選位（含即時可用狀態）─────────────────────────────────────────────────


class SeatState(BaseModel):
    """使用者選位畫面用：每個座位的即時狀態。"""

    id: uuid.UUID
    label: str
    block: str | None = None
    row_label: str | None = None
    x: int
    y: int
    seat_type: str
    price_delta: int
    # available / disabled / blocked / held(他人保留) / mine(我保留) / taken(已劃走)
    state: str


class SeatMapOut(BaseModel):
    """使用者選位畫面：場次 + 座位即時狀態 + 本人可劃額度與資格。"""

    zone_id: uuid.UUID
    product_id: uuid.UUID
    name: str
    starts_at: datetime | None = None
    layout: dict = {}
    hold_minutes: int
    seats: list[SeatState] = []
    # 本人在此票種剩餘可劃座位數（依購票數量）
    remaining_quota: int = 0
    # 是否已輪到本人劃位（分批開放時段判定）
    can_select_now: bool = True
    # 若尚未輪到，下一波對本人開放的時間
    next_open_at: datetime | None = None
    # 本人目前的保留鎖到期時間
    hold_expires_at: datetime | None = None


# ── 保留鎖 / 選位請求 ─────────────────────────────────────────────────────────


class HoldRequest(BaseModel):
    """選位 → 取得 / 更新本人在此場次的保留鎖（以送出的 seat_ids 為準）。"""

    seat_ids: list[uuid.UUID] = Field(default_factory=list)


class HoldOut(BaseModel):
    zone_id: uuid.UUID
    seat_ids: list[uuid.UUID] = []
    expires_at: datetime | None = None
    # 取得失敗（被他人搶先）的座位
    rejected_seat_ids: list[uuid.UUID] = []


class SeatSelectRequest(BaseModel):
    """確認劃位：將保留中的座位寫成正式劃位，綁定某張訂單。"""

    order_id: uuid.UUID
    seat_ids: list[uuid.UUID] = Field(..., min_length=1)


class AdminAssignRequest(BaseModel):
    """管理員代為劃位（admin_assign 模式，依到場順序）。"""

    order_id: uuid.UUID
    seat_ids: list[uuid.UUID] = Field(..., min_length=1)


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    seat_id: uuid.UUID
    seat_label: str | None = None
    zone_id: uuid.UUID
    zone_name: str | None = None
    order_id: uuid.UUID
    order_item_id: uuid.UUID | None = None
    user_id: uuid.UUID
    user_name: str | None = None
    assigned_by_id: uuid.UUID | None = None
    status: SeatAssignmentStatus
    created_at: datetime


__all__ = [
    "AdminAssignRequest",
    "AssignmentOut",
    "HoldOut",
    "HoldRequest",
    "SeatInput",
    "SeatMapOut",
    "SeatOut",
    "SeatSelectRequest",
    "SeatState",
    "SeatsReplace",
    "WaveInput",
    "WaveOut",
    "WavesReplace",
    "ZoneCreate",
    "ZoneListItem",
    "ZoneOut",
    "ZoneUpdate",
]
