"""物資管理系統：類別、品項、庫存異動、採購申請。"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.core.database import Base
from api.models.base import TimestampMixin

if TYPE_CHECKING:
    from api.models.loan import LoanItemCategory
    from api.models.org import Org
    from api.models.user import User


class InventoryItemType(enum.StrEnum):
    CONSUMABLE = "consumable"  # 消耗品（紙張、電池等）
    EQUIPMENT = "equipment"  # 設備（延長線、麥克風等）
    LOANABLE = "loanable"  # 可借用物品（連結借用模組）


class InventoryTxnType(enum.StrEnum):
    INITIAL = "initial"  # 期初建帳
    IN = "in"  # 進貨/補充
    OUT = "out"  # 耗用/發放
    ADJUSTMENT = "adjustment"  # 盤點調整
    DAMAGED = "damaged"  # 損耗
    LOST = "lost"  # 遺失


class InventoryProcurementStatus(enum.StrEnum):
    DRAFT = "draft"  # 草稿
    SUBMITTED = "submitted"  # 已提交待審
    APPROVED = "approved"  # 已核准
    REJECTED = "rejected"  # 已駁回
    RECEIVED = "received"  # 已收貨入庫


class InventoryCategory(Base, TimestampMixin):
    """物資類別，如「辦公耗材」、「音響設備」。"""

    __tablename__ = "inventory_categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)  # #RRGGBB
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)

    org: Mapped[Org] = relationship("Org")
    items: Mapped[list[InventoryItem]] = relationship(
        "InventoryItem", back_populates="category", cascade="all, delete-orphan"
    )


class InventoryItem(Base, TimestampMixin):
    """物資品項主表。"""

    __tablename__ = "inventory_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str] = mapped_column(String(20), nullable=False, default="個")
    item_type: Mapped[InventoryItemType] = mapped_column(
        String(20), nullable=False, default=InventoryItemType.CONSUMABLE, index=True
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    low_stock_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    # 可選連結至借用模組的物品類型（loanable 時使用）
    loan_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("loan_item_categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    org: Mapped[Org] = relationship("Org")
    category: Mapped[InventoryCategory | None] = relationship(
        "InventoryCategory", back_populates="items"
    )
    loan_item: Mapped[LoanItemCategory | None] = relationship("LoanItemCategory")
    transactions: Mapped[list[InventoryTransaction]] = relationship(
        "InventoryTransaction", back_populates="item", cascade="all, delete-orphan"
    )

    @property
    def is_low_stock(self) -> bool:
        return self.low_stock_threshold > 0 and self.quantity <= self.low_stock_threshold


class InventoryTransaction(Base, TimestampMixin):
    """庫存異動日誌，每次庫存變動都留下稽核紀錄。"""

    __tablename__ = "inventory_transactions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    txn_type: Mapped[InventoryTxnType] = mapped_column(String(20), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)  # delta（正=入庫，負=出庫）
    quantity_before: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity_after: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    item: Mapped[InventoryItem] = relationship("InventoryItem", back_populates="transactions")
    created_by: Mapped[User | None] = relationship("User")


class InventoryProcurement(Base, TimestampMixin):
    """採購申請主表。"""

    __tablename__ = "inventory_procurements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[InventoryProcurementStatus] = mapped_column(
        String(20), nullable=False, default=InventoryProcurementStatus.DRAFT, index=True
    )
    estimated_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requester_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requester_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    org: Mapped[Org] = relationship("Org")
    requester: Mapped[User] = relationship("User", foreign_keys=[requester_id])
    reviewer: Mapped[User | None] = relationship("User", foreign_keys=[reviewer_id])
    line_items: Mapped[list[InventoryProcurementItem]] = relationship(
        "InventoryProcurementItem", back_populates="procurement", cascade="all, delete-orphan"
    )


class InventoryProcurementItem(Base, TimestampMixin):
    """採購申請明細。"""

    __tablename__ = "inventory_procurement_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    procurement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_procurements.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 可空：採購新品項時尚未在系統建立
    item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_items.id", ondelete="SET NULL"),
        nullable=True,
    )
    item_name: Mapped[str] = mapped_column(String(200), nullable=False)
    item_unit: Mapped[str] = mapped_column(String(20), nullable=False, default="個")
    quantity_requested: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity_received: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    estimated_unit_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    procurement: Mapped[InventoryProcurement] = relationship(
        "InventoryProcurement", back_populates="line_items"
    )
    item: Mapped[InventoryItem | None] = relationship("InventoryItem")
