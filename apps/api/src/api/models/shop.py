"""購票 / 校商訂購系統 ORM 模型 - Product / Order / OrderItem"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
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

class ProductStatus(str, enum.Enum):
    DRAFT = "draft"           # 草稿（尚未上架）
    ACTIVE = "active"         # 上架中（可購買）
    SOLD_OUT = "sold_out"     # 售罄（庫存歸零）
    CANCELLED = "cancelled"   # 已下架


class OrderStatus(str, enum.Enum):
    PENDING = "pending"       # 待確認
    CONFIRMED = "confirmed"   # 已確認
    CANCELLED = "cancelled"   # 已取消
    REFUNDED = "refunded"     # 已退款


# ── 商品 / 票券 ────────────────────────────────────────────────────────────────

class Product(Base, TimestampMixin):
    """
    商品 / 票券主表。
    version 欄位用於 SQLAlchemy 樂觀鎖（version_id_col）：
    每次 UPDATE 時 SQLAlchemy 自動比對並遞增 version，
    若版本不符（已被他人修改）則拋出 StaleDataError，防止超賣。
    """

    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # ── 樂觀鎖版本欄位（必須在 __mapper_args__ 之前宣告）──────────────────────
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    __mapper_args__ = {"version_id_col": version}

    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 售價（新台幣，整數）
    price: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 庫存數量（-1 = 無限量）
    stock_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_unlimited: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[ProductStatus] = mapped_column(
        Enum(ProductStatus, name="productstatus"),
        nullable=False,
        default=ProductStatus.DRAFT,
        index=True,
    )
    sale_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sale_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )

    org: Mapped[Org] = relationship("Org")
    creator: Mapped[User] = relationship("User")
    order_items: Mapped[list[OrderItem]] = relationship("OrderItem", back_populates="product")


# ── 訂單 ──────────────────────────────────────────────────────────────────────

class Order(Base, TimestampMixin):
    """訂單主表"""

    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # 字號：ORD-YYYY-NNNNNN（與公文系統相同的原子性序號策略）
    serial_number: Mapped[str] = mapped_column(
        String(30), unique=True, nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    status: Mapped[OrderStatus] = mapped_column(
        Enum(OrderStatus, name="orderstatus"),
        nullable=False,
        default=OrderStatus.PENDING,
        index=True,
    )
    # 訂單總金額（新台幣，整數）
    total_price: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped[User] = relationship("User")
    org: Mapped[Org] = relationship("Org")
    items: Mapped[list[OrderItem]] = relationship(
        "OrderItem", back_populates="order", cascade="all, delete-orphan"
    )


# ── 訂單明細 ──────────────────────────────────────────────────────────────────

class OrderItem(Base, TimestampMixin):
    """訂單明細（商品快照：下單當時的單價）"""

    __tablename__ = "order_items"
    __table_args__ = (
        UniqueConstraint("order_id", "product_id", name="uq_order_product"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 下單時的單價快照（不受日後商品調價影響）
    unit_price: Mapped[int] = mapped_column(Integer, nullable=False)

    order: Mapped[Order] = relationship("Order", back_populates="items")
    product: Mapped[Product] = relationship("Product", back_populates="order_items")


__all__ = [
    "Order",
    "OrderItem",
    "OrderStatus",
    "Product",
    "ProductStatus",
]
