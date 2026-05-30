"""校商訂購系統 Pydantic Schemas - 分類 / 變體 / 商品 / 購物車 / 訂單 / 統計"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from api.models.shop import OrderStatus, ProductStatus

# ── 變體 ─────────────────────────────────────────────────────────────────────


class ProductVariantOptionCreate(BaseModel):
    value: str = Field(..., min_length=1, max_length=100, description="選項值，如「黑」「中」")
    image_url: str | None = None
    price_delta: int = Field(0, description="加價（新台幣，可為 0）")
    sort_order: int = 0


class ProductVariantOptionUpdate(BaseModel):
    value: str | None = Field(None, min_length=1, max_length=100)
    image_url: str | None = None
    price_delta: int | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class ProductVariantOptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    group_id: uuid.UUID
    value: str
    image_url: str | None
    price_delta: int
    sort_order: int
    is_active: bool


class ProductVariantGroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="變體群組名，如「尺寸」")
    sort_order: int = 0
    options: list[ProductVariantOptionCreate] = Field(default_factory=list)


class ProductVariantGroupUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    sort_order: int | None = None


class ProductVariantGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    product_id: uuid.UUID
    name: str
    sort_order: int
    options: list[ProductVariantOptionOut] = []


# ── 主題 / 系列 ───────────────────────────────────────────────────────────────


class ProductCategoryCreate(BaseModel):
    org_id: uuid.UUID = Field(..., description="所屬組織 ID")
    activity_id: uuid.UUID | None = Field(None, description="所屬活動 ID")
    name: str = Field(..., min_length=1, max_length=200, description="主題名稱，如「校商」")
    description: str | None = None
    image_url: str | None = None
    sort_order: int = 0


class ProductCategoryUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    image_url: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    activity_id: uuid.UUID | None = None


class ProductCategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    activity_id: uuid.UUID | None = None
    name: str
    description: str | None
    image_url: str | None
    sort_order: int
    is_active: bool
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class ProductSeriesCreate(BaseModel):
    category_id: uuid.UUID = Field(..., description="所屬主題 ID")
    name: str = Field(..., min_length=1, max_length=200, description="系列名稱，如「衣服系列」")
    description: str | None = None
    image_url: str | None = None
    sort_order: int = 0


class ProductSeriesUpdate(BaseModel):
    category_id: uuid.UUID | None = None
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    image_url: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class ProductSeriesOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category_id: uuid.UUID
    name: str
    description: str | None
    image_url: str | None
    sort_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


# ── 商品 ─────────────────────────────────────────────────────────────────────


class ProductCreate(BaseModel):
    series_id: uuid.UUID = Field(..., description="所屬系列 ID")
    name: str = Field(..., min_length=1, max_length=200, description="商品名稱")
    description: str | None = None
    image_url: str | None = None
    price: int = Field(..., ge=0, description="售價（新台幣）")
    stock_quantity: int = Field(0, ge=0, description="庫存（is_unlimited=True 時忽略）")
    is_unlimited: bool = False
    sale_start: datetime | None = Field(None, description="開售時間")
    sale_end: datetime | None = Field(None, description="截止時間")
    variant_groups: list[ProductVariantGroupCreate] = Field(default_factory=list)


class ProductUpdate(BaseModel):
    series_id: uuid.UUID | None = None
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    image_url: str | None = None
    price: int | None = Field(None, ge=0)
    stock_quantity: int | None = Field(None, ge=0)
    is_unlimited: bool | None = None
    sale_start: datetime | None = None
    sale_end: datetime | None = None


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    image_url: str | None
    price: int
    stock_quantity: int
    is_unlimited: bool
    status: ProductStatus
    version: int
    series_id: uuid.UUID
    org_id: uuid.UUID
    created_by: uuid.UUID
    sale_start: datetime | None
    sale_end: datetime | None
    created_at: datetime
    updated_at: datetime
    variant_groups: list[ProductVariantGroupOut] = []


# ── 購買頁瀏覽樹（主題 → 系列 → 商品）────────────────────────────────────────


class CatalogProductOut(BaseModel):
    id: uuid.UUID
    name: str
    image_url: str | None = None
    price: int
    status: ProductStatus
    stock_quantity: int
    is_unlimited: bool
    sale_start: datetime | None = None
    sale_end: datetime | None = None
    has_variants: bool = False


class CatalogSeriesOut(BaseModel):
    id: uuid.UUID
    name: str
    image_url: str | None = None
    sort_order: int = 0
    products: list[CatalogProductOut] = []


class CatalogCategoryOut(BaseModel):
    id: uuid.UUID
    name: str
    activity_id: uuid.UUID | None = None
    image_url: str | None = None
    sort_order: int = 0
    series: list[CatalogSeriesOut] = []


# ── 所選變體 ─────────────────────────────────────────────────────────────────


class SelectedOption(BaseModel):
    group_id: uuid.UUID
    group_name: str
    option_id: uuid.UUID
    value: str
    price_delta: int = 0


# ── 購物車 ───────────────────────────────────────────────────────────────────


class CartItemCreate(BaseModel):
    product_id: uuid.UUID
    quantity: int = Field(1, ge=1, le=100)
    option_ids: list[uuid.UUID] = Field(
        default_factory=list, description="所選變體選項 ID（每個變體群組需各選一個）"
    )


class CartItemUpdate(BaseModel):
    quantity: int = Field(..., ge=1, le=100)


class CartItemOut(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    product_image_url: str | None = None
    quantity: int
    unit_price: int
    subtotal: int
    selected_options: list[SelectedOption] = []
    available: bool = True
    unavailable_reason: str | None = None


class CartOut(BaseModel):
    id: uuid.UUID
    items: list[CartItemOut] = []
    total_price: int = 0


# ── 訂單 ─────────────────────────────────────────────────────────────────────


class OrderItemOut(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID
    product_name: str | None = None
    quantity: int
    unit_price: int
    subtotal: int
    selected_options: list[SelectedOption] = []


class OrderItemCreate(BaseModel):
    product_id: uuid.UUID
    quantity: int = Field(..., ge=1, le=100)
    option_ids: list[uuid.UUID] = Field(default_factory=list)


class OrderCreate(BaseModel):
    items: list[OrderItemCreate] = Field(..., min_length=1)
    notes: str | None = Field(None, max_length=500)


class OrderOut(BaseModel):
    id: uuid.UUID
    serial_number: str
    user_id: uuid.UUID
    org_id: uuid.UUID
    activity_id: uuid.UUID | None = None
    status: OrderStatus
    total_price: int
    notes: str | None = None
    class_id: uuid.UUID | None = None
    class_label: str | None = None
    is_paid: bool = False
    paid_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    items: list[OrderItemOut] = []


class OrderListItem(BaseModel):
    id: uuid.UUID
    serial_number: str
    user_id: uuid.UUID
    user_name: str | None = None
    org_id: uuid.UUID
    activity_id: uuid.UUID | None = None
    status: OrderStatus
    total_price: int
    class_id: uuid.UUID | None = None
    class_label: str | None = None
    is_paid: bool = False
    created_at: datetime


class CheckoutRequest(BaseModel):
    notes: str | None = Field(None, max_length=500, description="備註")


class OrderCancelRequest(BaseModel):
    reason: str | None = Field(None, max_length=500, description="取消原因")


class OrderPaymentUpdate(BaseModel):
    is_paid: bool = Field(..., description="是否已繳費")


# ── 後台統計 ─────────────────────────────────────────────────────────────────


class OrderSummaryRow(BaseModel):
    key: str
    label: str
    order_count: int
    item_count: int
    total_amount: int
    paid_amount: int
    unpaid_amount: int


class OrderSummaryOut(BaseModel):
    group_by: str
    rows: list[OrderSummaryRow] = []
    total_amount: int = 0
    paid_amount: int = 0
    unpaid_amount: int = 0


class ImageUploadOut(BaseModel):
    url: str


__all__ = [
    "CartItemCreate",
    "CartItemOut",
    "CartItemUpdate",
    "CartOut",
    "CatalogCategoryOut",
    "CatalogProductOut",
    "CatalogSeriesOut",
    "CheckoutRequest",
    "ImageUploadOut",
    "OrderCancelRequest",
    "OrderCreate",
    "OrderItemCreate",
    "OrderItemOut",
    "OrderListItem",
    "OrderOut",
    "OrderPaymentUpdate",
    "OrderSummaryOut",
    "OrderSummaryRow",
    "ProductCategoryCreate",
    "ProductCategoryOut",
    "ProductCategoryUpdate",
    "ProductCreate",
    "ProductOut",
    "ProductSeriesCreate",
    "ProductSeriesOut",
    "ProductSeriesUpdate",
    "ProductUpdate",
    "ProductVariantGroupCreate",
    "ProductVariantGroupOut",
    "ProductVariantGroupUpdate",
    "ProductVariantOptionCreate",
    "ProductVariantOptionOut",
    "ProductVariantOptionUpdate",
    "SelectedOption",
]
