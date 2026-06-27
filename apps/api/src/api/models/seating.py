"""劃位系統 ORM 模型 - 場次(座位圖) / 座位 / 劃位結果 / 暫時保留鎖 / 分批開放時段

設計概念（與商品系統整合）：
    Activity → ProductCategory(activity_id) → ProductSeries → Product(票種)
        └─ SeatingZone(場次，含座位圖)
             ├─ Seat(單一座位)
             └─ SeatingWave(分批開放時段，決定劃位優先順序)

劃位結果掛在 OrderItem 上（依購票數量決定可劃幾個位）。
搶位以 SeatHold 做「暫時保留鎖」：選位先取得 hold（DB 唯一索引保證原子），
結單時於同一交易內驗證 hold 仍有效後寫入 SeatAssignment。
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.types import JSONDict

if TYPE_CHECKING:
    from api.models.shop import Order, OrderItem, Product
    from api.models.user import User


# ── 枚舉 ──────────────────────────────────────────────────────────────────────


class SeatingMode(enum.StrEnum):
    """票種的劃位時機（掛在 Product.seating_mode）。"""

    AT_PURCHASE = "at_purchase"  # 購買即劃位（結單流程中選位）
    SCHEDULED = "scheduled"  # 指定時間開放後，購票者回來自助劃位
    ADMIN_ASSIGN = "admin_assign"  # 管理員依到場順序確認繳費後代為劃位


class SeatStatus(enum.StrEnum):
    AVAILABLE = "available"  # 可售可選
    DISABLED = "disabled"  # 走道 / 佔位用，不可選
    BLOCKED = "blocked"  # 保留不賣（管理員封鎖）


class SeatAssignmentStatus(enum.StrEnum):
    ACTIVE = "active"  # 有效劃位
    RELEASED = "released"  # 已釋放（退票 / 取消 / 改劃）


# ── 場次（座位圖）──────────────────────────────────────────────────────────────


class SeatingZone(Base, TimestampMixin):
    """
    場次（一張座位圖）。一個票種(Product)可有多個場次（如電影一天多場）。

    layout 存自由拖拉編輯器的畫布設定：
        {"width": int, "height": int, "stage": {...}, "blocks": [{"name", ...}]}
    """

    __tablename__ = "seating_zones"
    __table_args__ = (Index("ix_seating_zones_product_sort", "product_id", "sort_order"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 場次開演 / 開始時間（純顯示用，如電影 19:00 場）
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 自助劃位開放時間（seating_mode=scheduled 用；at_purchase 可留空）
    seating_opens_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 暫時保留鎖的有效分鐘數（選位後倒數）
    hold_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, default=10, server_default="10"
    )
    # 自由拖拉座位圖畫布設定
    layout: Mapped[dict] = mapped_column(
        JSONDict, nullable=False, default=dict, server_default="{}"
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    product: Mapped[Product] = relationship("Product", back_populates="seating_zones")
    seats: Mapped[list[Seat]] = relationship(
        "Seat", back_populates="zone", cascade="all, delete-orphan"
    )
    waves: Mapped[list[SeatingWave]] = relationship(
        "SeatingWave",
        back_populates="zone",
        cascade="all, delete-orphan",
        order_by="SeatingWave.sort_order",
    )


# ── 座位 ──────────────────────────────────────────────────────────────────────


class Seat(Base, TimestampMixin):
    """單一座位。座標 x/y 由自由拖拉編輯器決定，label 為對外顯示代號（如 A12）。"""

    __tablename__ = "seats"
    __table_args__ = (
        UniqueConstraint("zone_id", "label", name="uq_seat_zone_label"),
        Index("ix_seats_zone_status", "zone_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    zone_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("seating_zones.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    label: Mapped[str] = mapped_column(String(40), nullable=False)
    # 區塊名稱（對應 layout.blocks，如「VIP 區」「一樓」）
    block: Mapped[str | None] = mapped_column(String(80), nullable=True)
    row_label: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 畫布座標（像素或格點，前端決定單位）
    x: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    y: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 座位類型（如 normal / vip / wheelchair），純標記
    seat_type: Mapped[str] = mapped_column(
        String(40), nullable=False, default="normal", server_default="normal"
    )
    # 此座位加價（新台幣，整數，可為 0；如 VIP 區加價）
    price_delta: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    status: Mapped[SeatStatus] = mapped_column(
        Enum(SeatStatus, name="seatstatus", values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
        default=SeatStatus.AVAILABLE,
        server_default=SeatStatus.AVAILABLE.value,
    )

    zone: Mapped[SeatingZone] = relationship("SeatingZone", back_populates="seats")


# ── 分批開放時段（劃位優先順序）──────────────────────────────────────────────────


class SeatingWave(Base, TimestampMixin):
    """
    分批開放時段：決定誰先能劃位。

    audience 重用全站對象選擇機制（targeting / active_tenure_filter）的 JSON 結構，
    空 dict 代表「所有人」。順序由 starts_at 與 sort_order 決定，皆可由管理員調整。
    """

    __tablename__ = "seating_waves"
    __table_args__ = (Index("ix_seating_waves_zone_sort", "zone_id", "sort_order"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    zone_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("seating_zones.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # 此批次開放劃位的起始時間（到點後對象內成員即可劃位）
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 對象條件（重用 targeting 結構）；空 = 所有人
    audience: Mapped[dict] = mapped_column(
        JSONDict, nullable=False, default=dict, server_default="{}"
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    zone: Mapped[SeatingZone] = relationship("SeatingZone", back_populates="waves")


# ── 暫時保留鎖（搶位防衝突）──────────────────────────────────────────────────────


class SeatHold(Base, TimestampMixin):
    """
    選位暫時保留鎖。seat_id 唯一 → 一個座位同時只有一個 hold。

    取得方式：INSERT ... ON CONFLICT DO NOTHING（DB 層原子）。
    過期由 Celery 定期清理；查詢時亦以 expires_at 判定是否仍有效。
    """

    __tablename__ = "seat_holds"
    __table_args__ = (
        UniqueConstraint("seat_id", name="uq_seat_hold_seat"),
        Index("ix_seat_holds_expires", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    seat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("seats.id", ondelete="CASCADE"),
        nullable=False,
    )
    zone_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("seating_zones.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    seat: Mapped[Seat] = relationship("Seat")
    user: Mapped[User] = relationship("User")


# ── 劃位結果 ──────────────────────────────────────────────────────────────────


class SeatAssignment(Base, TimestampMixin):
    """
    劃位結果。掛在 OrderItem 上（依購票數量決定可劃幾個座位）。

    一個座位最多一筆 active 劃位 → 以 partial unique index 保證
    （ix_seat_assignment_active_seat WHERE status='active'）。
    """

    __tablename__ = "seat_assignments"
    __table_args__ = (
        Index(
            "uq_seat_assignment_active_seat",
            "seat_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
        Index("ix_seat_assignments_order", "order_id"),
        Index("ix_seat_assignments_zone_status", "zone_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    seat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("seats.id", ondelete="RESTRICT"),
        nullable=False,
    )
    zone_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("seating_zones.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
    )
    order_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("order_items.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # 入座者（通常 = 訂購人，保留欄位以支援代訂 / 多座位分配）
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # 代為劃位的管理員（admin_assign 模式）
    assigned_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[SeatAssignmentStatus] = mapped_column(
        Enum(
            SeatAssignmentStatus,
            name="seatassignmentstatus",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=SeatAssignmentStatus.ACTIVE,
        server_default=SeatAssignmentStatus.ACTIVE.value,
    )

    seat: Mapped[Seat] = relationship("Seat")
    zone: Mapped[SeatingZone] = relationship("SeatingZone")
    order: Mapped[Order] = relationship("Order", back_populates="seat_assignments")
    order_item: Mapped[OrderItem | None] = relationship("OrderItem")
    user: Mapped[User] = relationship("User", foreign_keys=[user_id])
    assigned_by: Mapped[User | None] = relationship("User", foreign_keys=[assigned_by_id])


__all__ = [
    "Seat",
    "SeatAssignment",
    "SeatAssignmentStatus",
    "SeatHold",
    "SeatStatus",
    "SeatingMode",
    "SeatingWave",
    "SeatingZone",
]
