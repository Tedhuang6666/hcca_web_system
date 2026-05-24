"""學餐訂購系統 Pydantic Schemas"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from api.models.meal import MealOrderStatus

# `date` 欄位名稱與 datetime.date 型別同名，在 `from __future__ import annotations`
# 環境下 Pydantic 無法分辨。用別名 _Date 指向型別，避免衝突。
_Date = date

# ── 商家 ─────────────────────────────────────────────────────────────────────


class MealVendorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    contact_phone: str | None
    contact_email: str | None
    is_active: bool
    status: str = "approved"
    review_note: str | None = None
    org_id: uuid.UUID
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class MealVendorCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="商家名稱")
    description: str | None = Field(None, description="商家描述")
    contact_phone: str | None = Field(None, max_length=20, description="聯絡電話")
    contact_email: EmailStr | None = Field(None, description="聯絡信箱")
    org_id: uuid.UUID | None = Field(None, description="所屬組織 ID；未提供時系統自動建立")
    manager_email: EmailStr | None = Field(None, description="建立時同步指派的商家負責人")
    status: str | None = Field(None, description="審核狀態；管理員手動新增預設 approved")


class MealVendorUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    contact_phone: str | None = Field(None, max_length=20)
    contact_email: EmailStr | None = None
    is_active: bool | None = None
    status: str | None = None
    review_note: str | None = None


class MealVendorApplicationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    contact_name: str | None = Field(None, max_length=100)
    contact_phone: str | None = Field(None, max_length=20)
    contact_email: EmailStr | None = None
    org_id: uuid.UUID | None = None


class MealVendorApplicationReview(BaseModel):
    approved: bool
    review_note: str | None = None


class MealVendorApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    contact_name: str | None
    contact_phone: str | None
    contact_email: str | None
    org_id: uuid.UUID
    status: str
    review_note: str | None
    reviewed_by_id: uuid.UUID | None
    reviewed_at: datetime | None
    vendor_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class MealProductCreate(BaseModel):
    vendor_id: uuid.UUID
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    category: str | None = Field(None, max_length=80)
    image_url: str | None = Field(None, max_length=500)
    price: int = Field(..., ge=0)
    default_max_quantity: int | None = Field(None, ge=1)


class MealProductUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    category: str | None = Field(None, max_length=80)
    image_url: str | None = Field(None, max_length=500)
    price: int | None = Field(None, ge=0)
    default_max_quantity: int | None = Field(None, ge=1)
    is_active: bool | None = None


class MealProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vendor_id: uuid.UUID
    name: str
    description: str | None
    category: str | None
    image_url: str | None
    price: int
    default_max_quantity: int | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class MealPickupSlotCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=80)
    sort_order: int = 0
    pickup_start: datetime
    pickup_end: datetime
    order_deadline: datetime
    capacity: int | None = Field(None, ge=1)


class MealPickupSlotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    availability_id: uuid.UUID
    label: str
    sort_order: int
    pickup_start: datetime
    pickup_end: datetime
    order_deadline: datetime
    capacity: int | None
    is_active: bool


class MealAvailabilityCreate(BaseModel):
    product_id: uuid.UUID
    service_date: _Date
    sale_start: datetime | None = None
    sale_end: datetime | None = None
    price: int | None = Field(None, ge=0)
    max_quantity: int | None = Field(None, ge=1)
    note: str | None = None
    pickup_slots: list[MealPickupSlotCreate] = Field(default_factory=list)


class MealWeeklyAvailabilityCreate(BaseModel):
    product_ids: list[uuid.UUID] = Field(..., min_length=1)
    date_from: _Date
    date_to: _Date
    weekdays: list[int] = Field(..., min_length=1, description="0=Monday ... 6=Sunday")
    sale_start_time: str | None = Field(None, description="HH:MM")
    sale_end_time: str | None = Field(None, description="HH:MM")
    pickup_slots: list[MealPickupSlotCreate] = Field(default_factory=list)


class MealAvailabilityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    product_id: uuid.UUID
    vendor_id: uuid.UUID
    service_date: _Date
    sale_start: datetime | None
    sale_end: datetime | None
    price: int
    max_quantity: int | None
    is_available: bool
    note: str | None
    product: MealProductOut | None = None
    pickup_slots: list[MealPickupSlotOut] = []


# ── 菜單排程 ─────────────────────────────────────────────────────────────────


class MenuItemSummary(BaseModel):
    """用於巢狀在 MenuScheduleOut 中的精簡品項"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    price: int
    max_quantity: int | None
    is_available: bool


class MenuScheduleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vendor_id: uuid.UUID
    date: _Date
    order_open_time: datetime | None
    order_deadline: datetime
    is_closed: bool
    note: str | None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    items: list[MenuItemSummary] = []


class MenuScheduleListItem(BaseModel):
    """列表輕量版（不含品項）"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vendor_id: uuid.UUID
    date: _Date
    order_open_time: datetime | None
    order_deadline: datetime
    is_closed: bool
    note: str | None
    created_at: datetime


class MenuScheduleCreate(BaseModel):
    vendor_id: uuid.UUID = Field(..., description="商家 ID")
    date: _Date = Field(..., description="服務日期")
    order_open_time: datetime | None = Field(None, description="開放訂餐時間（NULL=立即開放）")
    order_deadline: datetime = Field(..., description="結單截止時間（帶時區）")
    note: str | None = Field(None, max_length=500, description="備註")


class MenuScheduleUpdate(BaseModel):
    order_open_time: datetime | None = None
    order_deadline: datetime | None = None
    note: str | None = None


# ── 菜單品項 ─────────────────────────────────────────────────────────────────


class MenuItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    schedule_id: uuid.UUID | None
    name: str
    description: str | None
    price: int
    max_quantity: int | None
    is_available: bool
    created_at: datetime
    updated_at: datetime


class MenuItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="品項名稱")
    description: str | None = Field(None, description="品項描述")
    price: int = Field(..., ge=0, description="售價（新台幣）")
    max_quantity: int | None = Field(None, ge=1, description="最大數量（留空代表無限量）")


class MenuItemUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    price: int | None = Field(None, ge=0)
    max_quantity: int | None = Field(None, ge=1)
    is_available: bool | None = None


# ── 學餐訂單 ─────────────────────────────────────────────────────────────────


class MealOrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    menu_item_id: uuid.UUID | None = None
    availability_id: uuid.UUID | None = None
    product_name_snapshot: str | None = None
    quantity: int
    unit_price: int
    subtotal: int = 0

    @classmethod
    def model_validate(cls, obj, **kwargs):  # type: ignore[override]
        instance = super().model_validate(obj, **kwargs)
        instance.subtotal = instance.quantity * instance.unit_price
        return instance


class MealOrderItemCreate(BaseModel):
    menu_item_id: uuid.UUID | None = Field(None, description="舊版菜單品項 ID")
    availability_id: uuid.UUID | None = Field(None, description="商品上架 ID")
    quantity: int = Field(..., ge=1, le=20, description="購買數量")


class MealOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    serial_number: str
    pickup_code: str
    user_id: uuid.UUID
    schedule_id: uuid.UUID | None
    vendor_id: uuid.UUID
    availability_id: uuid.UUID | None = None
    pickup_slot_id: uuid.UUID | None = None
    class_id: uuid.UUID | None = None
    status: MealOrderStatus
    total_price: int
    is_paid: bool = False
    paid_at: datetime | None = None
    pickup_status: str = "not_picked"
    pickup_at: datetime | None = None
    notes: str | None
    reminder_sent_at: datetime | None = None
    is_no_show: bool = False
    created_at: datetime
    updated_at: datetime
    items: list[MealOrderItemOut] = []


class MealOrderListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    serial_number: str
    pickup_code: str
    user_id: uuid.UUID
    schedule_id: uuid.UUID
    vendor_id: uuid.UUID
    pickup_slot_id: uuid.UUID | None = None
    class_id: uuid.UUID | None = None
    status: MealOrderStatus
    total_price: int
    is_paid: bool = False
    pickup_status: str = "not_picked"
    is_no_show: bool = False
    created_at: datetime


class MealOrderCreate(BaseModel):
    schedule_id: uuid.UUID | None = Field(None, description="舊版菜單排程 ID")
    pickup_slot_id: uuid.UUID | None = Field(None, description="取餐時段 ID")
    items: list[MealOrderItemCreate] = Field(..., min_length=1, description="訂單品項（至少一項）")
    notes: str | None = Field(None, max_length=500, description="備註")


class MealOrderCancelRequest(BaseModel):
    reason: str | None = Field(None, max_length=500, description="取消原因")


# ── 熱門排序 / 核銷 ───────────────────────────────────────────────────────────


class ItemStatOut(BaseModel):
    """排程品項訂購統計（供前端熱門排序）"""

    item_id: uuid.UUID
    item_name: str
    total_ordered: int


class PickupListItemOut(BaseModel):
    """排程領餐名單列表項"""

    order_id: uuid.UUID
    serial_number: str
    pickup_code: str
    status: MealOrderStatus
    total_price: int
    notes: str | None
    created_at: datetime
    display_name: str
    student_id: str | None
    is_no_show: bool


class MealClassPickupCodeOut(BaseModel):
    code: str
    class_id: uuid.UUID
    vendor_id: uuid.UUID
    pickup_slot_id: uuid.UUID
    expires_at: datetime | None
    order_count: int


class MealPickupLookupOut(BaseModel):
    kind: str
    code: str
    matched_orders: int
    completed_orders: int
    total_price: int
    message: str


class VendorManagerAssignRequest(BaseModel):
    email: str = Field(..., description="要指派為學餐管理員的使用者 Email")


class VendorManagerOut(BaseModel):
    user_id: uuid.UUID
    display_name: str
    email: str
    position_id: uuid.UUID
    user_position_id: uuid.UUID
