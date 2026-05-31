"""校商訂購系統 ORM 模型 - 分類階層 / 商品 / 變體 / 購物車 / 訂單"""

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
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin
from api.models.school_class import ClassConsolidationMixin
from api.models.types import JSONDict

if TYPE_CHECKING:
    from api.models.activity import Activity
    from api.models.org import Org
    from api.models.school_class import SchoolClass
    from api.models.user import User


# ── 狀態枚舉 ──────────────────────────────────────────────────────────────────


class ProductStatus(enum.StrEnum):
    DRAFT = "draft"  # 草稿（尚未上架）
    ACTIVE = "active"  # 上架中（可購買）
    SOLD_OUT = "sold_out"  # 售罄（庫存歸零）
    CANCELLED = "cancelled"  # 已下架


class OrderStatus(enum.StrEnum):
    PENDING = "pending"  # 待確認
    CONFIRMED = "confirmed"  # 已確認
    CANCELLED = "cancelled"  # 已取消
    REFUNDED = "refunded"  # 已退款


# ── 分類階層：主題 → 系列 ──────────────────────────────────────────────────────


class ProductCategory(Base, TimestampMixin):
    """商品主題（最上層分類，如「校商」）"""

    __tablename__ = "product_categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("activities.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    org: Mapped[Org] = relationship("Org")
    activity: Mapped[Activity | None] = relationship("Activity")
    series: Mapped[list[ProductSeries]] = relationship(
        "ProductSeries", back_populates="category", cascade="all, delete-orphan"
    )


class ProductSeries(Base, TimestampMixin):
    """商品系列（屬於某主題，如「衣服系列」）"""

    __tablename__ = "product_series"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("product_categories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )

    category: Mapped[ProductCategory] = relationship("ProductCategory", back_populates="series")
    products: Mapped[list[Product]] = relationship("Product", back_populates="series")


# ── 商品 ──────────────────────────────────────────────────────────────────────


class Product(Base, TimestampMixin):
    """
    商品主表。
    version 欄位用於 SQLAlchemy 樂觀鎖（version_id_col）：
    每次 UPDATE 時 SQLAlchemy 自動比對並遞增 version，防止超賣。
    """

    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # ── 樂觀鎖版本欄位（必須在 __mapper_args__ 之前宣告）──────────────────────
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    __mapper_args__ = {"version_id_col": version}

    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 售價（新台幣，整數）；變體加價另計於 ProductVariantOption.price_delta
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
    # 截止時間：過後不再接受新訂單，並依班級結單
    sale_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    series_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("product_series.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
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
    series: Mapped[ProductSeries] = relationship("ProductSeries", back_populates="products")
    variant_groups: Mapped[list[ProductVariantGroup]] = relationship(
        "ProductVariantGroup",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="ProductVariantGroup.sort_order",
    )
    order_items: Mapped[list[OrderItem]] = relationship("OrderItem", back_populates="product")


# ── 變體：群組（尺寸 / 顏色）→ 選項（中 / 黑）──────────────────────────────────


class ProductVariantGroup(Base, TimestampMixin):
    """變體群組（如「尺寸」「顏色」）"""

    __tablename__ = "product_variant_groups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    product: Mapped[Product] = relationship("Product", back_populates="variant_groups")
    options: Mapped[list[ProductVariantOption]] = relationship(
        "ProductVariantOption",
        back_populates="group",
        cascade="all, delete-orphan",
        order_by="ProductVariantOption.sort_order",
    )


class ProductVariantOption(Base, TimestampMixin):
    """變體選項（如「黑」「中」），可附圖片並設定加價"""

    __tablename__ = "product_variant_options"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("product_variant_groups.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    value: Mapped[str] = mapped_column(String(100), nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 加價（新台幣，整數，可為 0）
    price_delta: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )

    group: Mapped[ProductVariantGroup] = relationship(
        "ProductVariantGroup", back_populates="options"
    )


# ── 購物車 ────────────────────────────────────────────────────────────────────


class Cart(Base, TimestampMixin):
    """購物車（後端持久化，一位使用者一車）"""

    __tablename__ = "carts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    user: Mapped[User] = relationship("User")
    items: Mapped[list[CartItem]] = relationship(
        "CartItem", back_populates="cart", cascade="all, delete-orphan"
    )


class CartItem(Base, TimestampMixin):
    """購物車明細（含所選變體）"""

    __tablename__ = "cart_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cart_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("carts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 所選變體：list[{group_id, group_name, option_id, value, price_delta}]
    selected_options: Mapped[list] = mapped_column(
        JSONDict, nullable=False, default=list, server_default="[]"
    )

    cart: Mapped[Cart] = relationship("Cart", back_populates="items")
    product: Mapped[Product] = relationship("Product")


# ── 訂單 ──────────────────────────────────────────────────────────────────────


class Order(Base, TimestampMixin, ClassConsolidationMixin):
    """
    訂單主表。

    沿用 ClassConsolidationMixin 提供的 class_id / is_paid / paid_at / paid_by_id，
    使「依班級結單、幹部標示繳費」制度可與學餐系統共用。
    """

    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 字號：ORD-YYYY-NNNNNN
    serial_number: Mapped[str] = mapped_column(String(30), unique=True, nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orgs.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    assistance_scope: Mapped[str] = mapped_column(
        String(30), nullable=False, default="self", server_default="self", index=True
    )
    assisted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
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

    user: Mapped[User] = relationship("User", foreign_keys=[user_id])
    assisted_by: Mapped[User | None] = relationship("User", foreign_keys=[assisted_by_id])
    org: Mapped[Org] = relationship("Org")
    school_class: Mapped[SchoolClass | None] = relationship(
        "SchoolClass", foreign_keys="Order.class_id"
    )
    items: Mapped[list[OrderItem]] = relationship(
        "OrderItem", back_populates="order", cascade="all, delete-orphan"
    )


# ── 訂單明細 ──────────────────────────────────────────────────────────────────


class OrderItem(Base, TimestampMixin):
    """訂單明細（下單當時的單價與變體快照）"""

    __tablename__ = "order_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # 下單時的單價快照（= 商品價 + 變體加價總和，不受日後調價影響）
    unit_price: Mapped[int] = mapped_column(Integer, nullable=False)
    # 所選變體快照：list[{group_id, group_name, option_id, value, price_delta}]
    selected_options: Mapped[list] = mapped_column(
        JSONDict, nullable=False, default=list, server_default="[]"
    )

    order: Mapped[Order] = relationship("Order", back_populates="items")
    product: Mapped[Product] = relationship("Product", back_populates="order_items")


__all__ = [
    "Cart",
    "CartItem",
    "Order",
    "OrderItem",
    "OrderStatus",
    "Product",
    "ProductCategory",
    "ProductSeries",
    "ProductStatus",
    "ProductVariantGroup",
    "ProductVariantOption",
]
