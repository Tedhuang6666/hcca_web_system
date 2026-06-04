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
    from api.models.school_class import SchoolClass
    from api.models.user import User


# ── 狀態枚舉 ──────────────────────────────────────────────────────────────────


class MealOrderStatus(enum.StrEnum):
    PENDING = "pending"  # 已下單，待確認
    CONFIRMED = "confirmed"  # 商家已確認
    CANCELLED = "cancelled"  # 已取消
    COMPLETED = "completed"  # 已完成（取餐）


class MealVendorStatus(enum.StrEnum):
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    SUSPENDED = "suspended"


class MealPickupStatus(enum.StrEnum):
    NOT_PICKED = "not_picked"
    PICKED = "picked"
    CLASS_PICKED = "class_picked"
    NO_SHOW = "no_show"


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
    status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default=MealVendorStatus.APPROVED,
        server_default="approved",
        index=True,
    )
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)

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
    products: Mapped[list[MealProduct]] = relationship(
        "MealProduct", back_populates="vendor", cascade="all, delete-orphan"
    )


class MealVendorApplication(Base, TimestampMixin):
    """店家入駐申請。"""

    __tablename__ = "meal_vendor_applications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default=MealVendorStatus.PENDING_REVIEW,
        server_default="pending_review",
        index=True,
    )
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    vendor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meal_vendors.id", ondelete="SET NULL"), nullable=True
    )

    org: Mapped[Org] = relationship("Org")
    vendor: Mapped[MealVendor | None] = relationship("MealVendor")


class MealVendorManager(Base, TimestampMixin):
    """商家管理人綁定，避免只用組織 membership 造成跨商家存取。"""

    __tablename__ = "meal_vendor_managers"
    __table_args__ = (UniqueConstraint("vendor_id", "user_id", name="uq_meal_vendor_manager"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meal_vendors.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    position_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("positions.id", ondelete="SET NULL"), nullable=True
    )
    user_position_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user_positions.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )

    vendor: Mapped[MealVendor] = relationship("MealVendor")
    user: Mapped[User] = relationship("User", foreign_keys=[user_id])


class MealProduct(Base, TimestampMixin):
    """商家商品目錄，供多日上架重用。"""

    __tablename__ = "meal_products"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meal_vendors.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    price: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    default_max_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    vendor: Mapped[MealVendor] = relationship("MealVendor", back_populates="products")
    availabilities: Mapped[list[MealProductAvailability]] = relationship(
        "MealProductAvailability", back_populates="product", cascade="all, delete-orphan"
    )


class MealProductAvailability(Base, TimestampMixin):
    """商品在特定供餐日的上架設定。"""

    __tablename__ = "meal_product_availabilities"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meal_products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meal_vendors.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    service_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    sale_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sale_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    price: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_available: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    product: Mapped[MealProduct] = relationship("MealProduct", back_populates="availabilities")
    vendor: Mapped[MealVendor] = relationship("MealVendor")
    pickup_slots: Mapped[list[MealPickupSlot]] = relationship(
        "MealPickupSlot", back_populates="availability", cascade="all, delete-orphan"
    )


class MealPickupSlot(Base, TimestampMixin):
    """商品上架後可選的取餐時段。"""

    __tablename__ = "meal_pickup_slots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    availability_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meal_product_availabilities.id", ondelete="CASCADE"),
        index=True,
    )
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pickup_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    pickup_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    order_deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    availability: Mapped[MealProductAvailability] = relationship(
        "MealProductAvailability", back_populates="pickup_slots"
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
    availability_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meal_product_availabilities.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    pickup_slot_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meal_pickup_slots.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    class_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("school_classes.id", ondelete="SET NULL"),
        nullable=True,
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
        nullable=True,
        index=True,
    )
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meal_vendors.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    availability_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meal_product_availabilities.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    pickup_slot_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meal_pickup_slots.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    class_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("school_classes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    assistance_scope: Mapped[str] = mapped_column(
        String(30), nullable=False, default="self", server_default="self", index=True
    )
    assisted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[MealOrderStatus] = mapped_column(
        # values_callable 強制使用 .value（小寫 "confirmed"）而非 .name（大寫 "CONFIRMED"）；
        # DB enum mealorderstatus 的 label 是小寫（見 add_meal_system_tables migration）。
        Enum(
            MealOrderStatus,
            name="mealorderstatus",
            values_callable=lambda obj: [e.value for e in obj],
        ),
        nullable=False,
        default=MealOrderStatus.PENDING,
        index=True,
    )
    total_price: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_paid: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    pickup_status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default=MealPickupStatus.NOT_PICKED,
        server_default="not_picked",
        index=True,
    )
    pickup_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pickup_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 未取餐追蹤
    reminder_sent_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_no_show: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    user: Mapped[User] = relationship("User", foreign_keys=[user_id])
    assisted_by: Mapped[User | None] = relationship("User", foreign_keys=[assisted_by_id])
    paid_by: Mapped[User | None] = relationship("User", foreign_keys=[paid_by_id])
    pickup_by: Mapped[User | None] = relationship("User", foreign_keys=[pickup_by_id])
    schedule: Mapped[MenuSchedule] = relationship("MenuSchedule", back_populates="orders")
    vendor: Mapped[MealVendor] = relationship("MealVendor")
    availability: Mapped[MealProductAvailability | None] = relationship("MealProductAvailability")
    pickup_slot: Mapped[MealPickupSlot | None] = relationship("MealPickupSlot")
    school_class: Mapped[SchoolClass | None] = relationship("SchoolClass")
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
        nullable=True,
        index=True,
    )
    availability_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("meal_product_availabilities.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    product_name_snapshot: Mapped[str | None] = mapped_column(String(200), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 下單時的單價快照（不受日後調價影響）
    unit_price: Mapped[int] = mapped_column(Integer, nullable=False)

    order: Mapped[MealOrder] = relationship("MealOrder", back_populates="items")
    menu_item: Mapped[MenuItem | None] = relationship("MenuItem", back_populates="order_items")
    availability: Mapped[MealProductAvailability | None] = relationship("MealProductAvailability")


class MealClassPickupCode(Base, TimestampMixin):
    """午餐股長使用的整班隨機領取碼，範圍為同班級、同商家、同取餐時段。"""

    __tablename__ = "meal_class_pickup_codes"
    __table_args__ = (
        UniqueConstraint(
            "class_id", "vendor_id", "pickup_slot_id", name="uq_meal_class_pickup_scope"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False, index=True)
    class_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("school_classes.id", ondelete="CASCADE"), index=True
    )
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meal_vendors.id", ondelete="CASCADE"), index=True
    )
    pickup_slot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meal_pickup_slots.id", ondelete="CASCADE"), index=True
    )
    issued_to_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    redeemed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    school_class: Mapped[SchoolClass] = relationship("SchoolClass")
    vendor: Mapped[MealVendor] = relationship("MealVendor")
    pickup_slot: Mapped[MealPickupSlot] = relationship("MealPickupSlot")


__all__ = [
    "MealOrder",
    "MealOrderItem",
    "MealOrderStatus",
    "MealPickupStatus",
    "MealClassPickupCode",
    "MealPickupSlot",
    "MealProduct",
    "MealProductAvailability",
    "MealVendor",
    "MealVendorApplication",
    "MealVendorManager",
    "MealVendorStatus",
    "MenuItem",
    "MenuSchedule",
]
