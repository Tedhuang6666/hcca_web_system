"""購票 / 校商訂購系統 Pydantic Schemas"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from api.models.shop import OrderStatus, ProductStatus

# ── 商品 ─────────────────────────────────────────────────────────────────────


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    price: int
    stock_quantity: int
    is_unlimited: bool
    status: ProductStatus
    version: int
    org_id: uuid.UUID
    created_by: uuid.UUID
    sale_start: datetime | None
    sale_end: datetime | None
    created_at: datetime
    updated_at: datetime


class ProductCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="商品名稱")
    description: str | None = Field(None, description="商品描述")
    price: int = Field(..., ge=0, description="售價（新台幣）")
    stock_quantity: int = Field(0, ge=0, description="庫存數量（is_unlimited=True 時忽略）")
    is_unlimited: bool = Field(False, description="是否為無限量")
    org_id: uuid.UUID = Field(..., description="所屬組織 ID")
    sale_start: datetime | None = Field(None, description="開售時間")
    sale_end: datetime | None = Field(None, description="截止時間")


class ProductUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    price: int | None = Field(None, ge=0)
    stock_quantity: int | None = Field(None, ge=0)
    is_unlimited: bool | None = None
    sale_start: datetime | None = None
    sale_end: datetime | None = None


class ProductActivateRequest(BaseModel):
    """上架商品（DRAFT → ACTIVE）"""

    pass


# ── 訂單明細 ─────────────────────────────────────────────────────────────────


class OrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    product_id: uuid.UUID
    quantity: int
    unit_price: int
    subtotal: int = 0  # 計算欄位，由 validator 填入

    @classmethod
    def model_validate(cls, obj, **kwargs):  # type: ignore[override]
        instance = super().model_validate(obj, **kwargs)
        instance.subtotal = instance.quantity * instance.unit_price
        return instance


class OrderItemCreate(BaseModel):
    product_id: uuid.UUID = Field(..., description="商品 ID")
    quantity: int = Field(..., ge=1, le=100, description="購買數量")


# ── 訂單 ─────────────────────────────────────────────────────────────────────


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    serial_number: str
    user_id: uuid.UUID
    org_id: uuid.UUID
    status: OrderStatus
    total_price: int
    notes: str | None
    created_at: datetime
    updated_at: datetime
    items: list[OrderItemOut] = []


class OrderListItem(BaseModel):
    """訂單列表輕量版"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    serial_number: str
    user_id: uuid.UUID
    org_id: uuid.UUID
    status: OrderStatus
    total_price: int
    created_at: datetime


class OrderCreate(BaseModel):
    items: list[OrderItemCreate] = Field(..., min_length=1, description="訂單明細（至少一項）")
    notes: str | None = Field(None, max_length=500, description="備註")


class OrderCancelRequest(BaseModel):
    reason: str | None = Field(None, max_length=500, description="取消原因")
