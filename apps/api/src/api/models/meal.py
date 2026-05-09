"""學餐訂購系統 ORM 模型 - MealVendor / MenuSchedule / MenuItem / MealOrder / MealOrderItem"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.org import Org
    from api.models.user import User


# ── 狀態枚舉 ──────────────────────────────────────────────────────────────────


class MealOrderStatus(enum.StrEnum):
    PENDING = "pending"  # 已下單，待確認
    CONFIRMED = "confirmed"  # 商家已確認
    CANCELLED = "cancelled"  # 已取消
    COMPLETED = "completed"  # 已完成（取餐）


# ── 商家（學餐供應商）────────────────────────────────────────────────────────────


class MealVendor(Base, TimestampMixin):
    """學餐供應商（商家）。一個商家可以提供多日菜單排程。"""

    __tablename__ = "meal_vendors"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orgs.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    org: Mapped[Org] = relationship("Org")
    creator: Mapped[User] = relationship("User")
    schedules: Mapped[list[MenuSchedule]] = relationship(
        "MenuSchedule", back_populates="vendor", cascade="all, delete-orphan"
    )


# ── 每日菜單排程 ──────────────────────────────────────────────────────────────


class MenuSchedule(Base, TimestampMixin):
    """
    一日菜單排程（一個商家 × 一天 = 唯一排程）。
    order_deadline：結單截止時間，過後自動或手動關閉。
    is_closed：True 代表已結單，不接受新訂單也不允許取消。
    """

    __tablename__ = "menu_schedules"
    __table_args__ = (UniqueConstraint("vendor_id", "date", name="uq_vendor_date"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meal_vendors.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 服務日期（YYYY-MM-DD），僅日期不含時間
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # 開放訂餐時間（帶時區，NULL = 立即開放）
    order_open_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 結單截止時間（帶時區）
    order_deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    vendor: Mapped[MealVendor] = relationship("MealVendor", back_populates="schedules")
    creator: Mapped[User] = relationship("User")
    items: Mapped[list[MenuItem]] = relationship(
        "MenuItem", back_populates="schedule", cascade="all, delete-orphan"
    )
    orders: Mapped[list[MealOrder]] = relationship("MealOrder", back_populates="schedule")


# ── 菜單品項 ──────────────────────────────────────────────────────────────────


class MenuItem(Base, TimestampMixin):
    """菜單品項（屬於某一日排程）。max_quantity=None 代表無限量。"""

    __tablename__ = "menu_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    schedule_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("menu_schedules.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 售價（新台幣，整數）
    price: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 最大數量限制（NULL = 無限量）
    max_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    schedule: Mapped[MenuSchedule] = relationship("MenuSchedule", back_populates="items")
    order_items: Mapped[list[MealOrderItem]] = relationship(
        "MealOrderItem", back_populates="menu_item"
    )


# ── 學餐訂單 ──────────────────────────────────────────────────────────────────


class MealOrder(Base, TimestampMixin):
    """
    學餐訂單。
    一位學生對同一個菜單排程只能有一張訂單（UNIQUE user_id + schedule_id）。
    """

    __tablename__ = "meal_orders"
    __table_args__ = (UniqueConstraint("user_id", "schedule_id", name="uq_user_schedule"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 系統字號：MEAL-YYYY-NNNNNN（報表/稽核用）
    serial_number: Mapped[str] = mapped_column(String(30), unique=True, nullable=False, index=True)
    # 取餐代碼：5 位數字（使用者出示取餐用，每日量少時不易衝突）
    pickup_code: Mapped[str] = mapped_column(String(5), unique=True, nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    schedule_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("menu_schedules.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meal_vendors.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    status: Mapped[MealOrderStatus] = mapped_column(
        Enum(MealOrderStatus, name="mealorderstatus"),
        nullable=False,
        default=MealOrderStatus.PENDING,
        index=True,
    )
    total_price: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 未取餐追蹤
    reminder_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_no_show: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    user: Mapped[User] = relationship("User")
    schedule: Mapped[MenuSchedule] = relationship("MenuSchedule", back_populates="orders")
    vendor: Mapped[MealVendor] = relationship("MealVendor")
    items: Mapped[list[MealOrderItem]] = relationship(
        "MealOrderItem", back_populates="order", cascade="all, delete-orphan"
    )


# ── 學餐訂單明細 ──────────────────────────────────────────────────────────────


class MealOrderItem(Base, TimestampMixin):
    """學餐訂單明細（含下單時的單價快照）"""

    __tablename__ = "meal_order_items"
    __table_args__ = (UniqueConstraint("order_id", "menu_item_id", name="uq_meal_order_item"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meal_orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    menu_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("menu_items.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 下單時的單價快照（不受日後調價影響）
    unit_price: Mapped[int] = mapped_column(Integer, nullable=False)

    order: Mapped[MealOrder] = relationship("MealOrder", back_populates="items")
    menu_item: Mapped[MenuItem] = relationship("MenuItem", back_populates="order_items")


__all__ = [
    "MealOrder",
    "MealOrderItem",
    "MealOrderStatus",
    "MealVendor",
    "MenuItem",
    "MenuSchedule",
]
