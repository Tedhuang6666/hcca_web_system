"""商品訂購系統 Pydantic Schemas - 分類 / 變體 / 商品登記 / 訂單 / 統計"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from api.models.shop import OrderStatus, ProductStatus, ShopDiscountType

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


class ShopActivityDeadlineUpdate(BaseModel):
    order_closes_at: AwareDatetime | None = Field(
        ..., description="活動商品停止訂購時間；null 表示取消活動統一期限"
    )


class ShopActivityOrderClosureUpdate(BaseModel):
    is_closed: bool = Field(..., description="結單鎖定活動訂購；false 重新開放，仍受原期限限制")


class ProductCategoryCreate(BaseModel):
    activity_id: uuid.UUID | None = Field(None, description="所屬活動 ID")
    name: str = Field(..., min_length=1, max_length=200, description="主題名稱，如「商品」")
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


class ProductMediaCreate(BaseModel):
    image_url: str = Field(min_length=1, description="圖片路徑")
    kind: Literal["product", "model"] = "product"
    sort_order: int = Field(0, ge=0)


class ProductMediaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    image_url: str
    kind: Literal["product", "model"]
    sort_order: int


class ProductCreate(BaseModel):
    category_id: uuid.UUID | None = Field(None, description="所屬主題 ID；單一商品可不選系列")
    series_id: uuid.UUID | None = Field(None, description="所屬系列 ID；可留空直接放在主題下")
    name: str = Field(..., min_length=1, max_length=200, description="商品名稱")
    description: str | None = None
    image_url: str | None = None
    price: int = Field(..., ge=0, description="售價（新台幣）")
    stock_quantity: int = Field(0, ge=0, description="庫存（is_unlimited=True 時忽略）")
    is_unlimited: bool = False
    max_quantity_per_user: int | None = Field(
        None, ge=1, description="每位使用者累計購買上限；留空表示不限購"
    )
    sale_start: datetime | None = Field(None, description="開售時間")
    sale_end: datetime | None = Field(None, description="單品截止時間；留空沿用活動結單時間")
    requires_seating: bool = Field(False, description="是否為需劃位票種")
    seating_mode: str | None = Field(
        None, description="劃位時機：at_purchase / scheduled / admin_assign"
    )
    variant_groups: list[ProductVariantGroupCreate] = Field(default_factory=list)
    media: list[ProductMediaCreate] = Field(default_factory=list, max_length=20)


class ProductUpdate(BaseModel):
    category_id: uuid.UUID | None = None
    series_id: uuid.UUID | None = None
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    image_url: str | None = None
    price: int | None = Field(None, ge=0)
    stock_quantity: int | None = Field(None, ge=0)
    is_unlimited: bool | None = None
    max_quantity_per_user: int | None = Field(
        None, ge=1, description="每位使用者累計購買上限；設為 null 表示不限購"
    )
    sale_start: datetime | None = None
    sale_end: datetime | None = None
    requires_seating: bool | None = None
    seating_mode: str | None = None
    media: list[ProductMediaCreate] | None = Field(None, max_length=20)


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    image_url: str | None
    price: int
    stock_quantity: int
    is_unlimited: bool
    max_quantity_per_user: int | None = None
    remaining_quantity_for_user: int | None = None
    status: ProductStatus
    version: int
    category_id: uuid.UUID | None = None
    series_id: uuid.UUID | None
    created_by: uuid.UUID
    sale_start: datetime | None
    sale_end: datetime | None
    effective_sale_end: datetime | None = None
    requires_seating: bool = False
    seating_mode: str | None = None
    created_at: datetime
    updated_at: datetime
    variant_groups: list[ProductVariantGroupOut] = []
    media: list[ProductMediaOut] = []


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
    effective_sale_end: datetime | None = None
    has_variants: bool = False
    requires_seating: bool = False
    seating_mode: str | None = None


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
    activity_name: str | None = None
    order_closes_at: datetime | None = None
    order_closed_at: datetime | None = None
    activity_status: str | None = None
    image_url: str | None = None
    sort_order: int = 0
    products: list[CatalogProductOut] = []
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
    max_quantity_per_user: int | None = None
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
    ordered_by_id: uuid.UUID | None = None
    ordered_by_name: str | None = None
    delegation_link_id: uuid.UUID | None = None
    delegation_name: str | None = None


class OrderItemCreate(BaseModel):
    product_id: uuid.UUID
    quantity: int = Field(..., ge=1, le=100)
    option_ids: list[uuid.UUID] = Field(default_factory=list)


class RegistrationVariantCreate(BaseModel):
    option_ids: list[uuid.UUID] = Field(default_factory=list)
    quantity: int = Field(..., ge=1, le=100)


class CurrentRegistrationUpdate(BaseModel):
    variants: list[RegistrationVariantCreate] = Field(default_factory=list, max_length=100)


class ShopDelegationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    category_id: uuid.UUID

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("請輸入連結名稱")
        return value.strip()


class ShopDelegationUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("請輸入連結名稱")
        return value.strip()


class ShopDelegationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category_id: uuid.UUID
    activity_id: uuid.UUID | None = None
    name: str
    bound_user_name: str | None = None
    bound_user_email: str | None = None
    revoked_at: datetime | None
    created_at: datetime
    token: str | None = None  # 僅建立／重新產生時回傳一次。
    authorization_code: str | None = None  # 短效七位數碼，僅建立／重新產生時回傳。
    authorization_code_expires_at: datetime | None = None


class ShopDelegationCodeCreate(BaseModel):
    code: str = Field(pattern=r"^[0-9]{7}$")


class ShopDelegationCodeOut(BaseModel):
    token: str


class ShopDelegationAccess(BaseModel):
    token: str = Field(min_length=32, max_length=100)
    claim: bool = False


class ShopDelegationRegistrationUpdate(ShopDelegationAccess, CurrentRegistrationUpdate):
    pass


class ShopDelegationPromotionUpdate(ShopDelegationAccess):
    code: str | None = Field(None, max_length=80)


class OrderItemQuantityUpdate(BaseModel):
    quantity: int = Field(ge=0, le=100)


class OrderCreate(BaseModel):
    items: list[OrderItemCreate] = Field(..., min_length=1)
    notes: str | None = Field(None, max_length=500)


class ClassOrderUpsert(BaseModel):
    user_id: uuid.UUID
    items: list[OrderItemCreate] = Field(..., min_length=1)
    notes: str | None = Field(None, max_length=500)


class ClassOrderCreate(BaseModel):
    user_id: uuid.UUID | None = None
    roster_entry_id: uuid.UUID | None = None
    items: list[OrderItemCreate] = Field(..., min_length=1)
    notes: str | None = Field(None, max_length=500)

    @model_validator(mode="after")
    def validate_recipient(self) -> Self:
        if (self.user_id is None) == (self.roster_entry_id is None):
            raise ValueError("請擇一提供學生帳號或座號名冊資料")
        return self


class AdminAssistedOrderCreate(ClassOrderCreate):
    collection_mode: Literal["class", "separate"] = "class"
    payment_method: Literal["cash_on_pickup", "bank_transfer"] = "cash_on_pickup"


class OrderPromotionOut(BaseModel):
    promotion_id: uuid.UUID
    name: str
    code: str | None = None
    discount_amount: int


class OrderOut(BaseModel):
    id: uuid.UUID
    supplement_class_id: uuid.UUID | None = None
    test_product_id: uuid.UUID | None = None
    serial_number: str
    user_id: uuid.UUID
    activity_id: uuid.UUID | None = None
    activity_name: str | None = None
    category_id: uuid.UUID | None = None
    category_name: str | None = None
    status: OrderStatus
    subtotal_price: int = 0
    discount_amount: int = 0
    total_price: int
    promotion_id: uuid.UUID | None = None
    promotion_code: str | None = None
    applied_promotions: list[OrderPromotionOut] = Field(default_factory=list)
    payment_method: str = "cash_on_pickup"
    notes: str | None = None
    class_id: uuid.UUID | None = None
    class_label: str | None = None
    assistance_scope: str = "self"
    assisted_by_id: uuid.UUID | None = None
    is_paid: bool = False
    is_class_collected: bool = False
    class_collected_at: datetime | None = None
    paid_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    items: list[OrderItemOut] = []


class OrderListItem(BaseModel):
    id: uuid.UUID
    supplement_class_id: uuid.UUID | None = None
    test_product_id: uuid.UUID | None = None
    serial_number: str
    user_id: uuid.UUID
    user_name: str | None = None
    activity_id: uuid.UUID | None = None
    activity_name: str | None = None
    category_id: uuid.UUID | None = None
    category_name: str | None = None
    status: OrderStatus
    subtotal_price: int = 0
    discount_amount: int = 0
    total_price: int
    promotion_code: str | None = None
    payment_method: str = "cash_on_pickup"
    class_id: uuid.UUID | None = None
    class_label: str | None = None
    assistance_scope: str = "self"
    assisted_by_id: uuid.UUID | None = None
    is_paid: bool = False
    is_class_collected: bool = False
    created_at: datetime
    items: list[OrderItemOut] = Field(default_factory=list)


class ShopDelegatedOrderOut(BaseModel):
    order: OrderListItem
    editable_item_ids: list[uuid.UUID] = Field(default_factory=list)


class CheckoutRequest(BaseModel):
    notes: str | None = Field(None, max_length=500, description="備註")
    coupon_code: str | None = Field(None, max_length=80, description="優惠碼")
    payment_method: str | None = Field(None, max_length=30, description="付款方式")


class ShopPromotionPreviewRequest(BaseModel):
    code: str | None = Field(None, max_length=80, description="優惠碼；留空時檢查帳號自動優惠")
    activity_id: uuid.UUID | None = Field(None, description="優惠所屬活動")
    category_id: uuid.UUID | None = Field(None, description="未綁活動時的商品分類")


class ShopPromotionProductPriceCreate(BaseModel):
    product_id: uuid.UUID
    unit_price: int = Field(..., ge=0, description="優惠後單價（新台幣）")


class ShopPromotionProductPriceOut(BaseModel):
    product_id: uuid.UUID
    product_name: str
    unit_price: int


class ShopPromotionPreviewOut(BaseModel):
    eligible: bool
    promotion_name: str | None = None
    promotion_code: str | None = None
    reason_code: Literal[
        "applied",
        "minimum_not_met",
        "invalid_code",
        "not_started",
        "expired",
        "inactive",
        "usage_limit",
        "account_not_eligible",
        "items_not_matched",
        "quantity_not_met",
        "activity_not_matched",
        "no_promotion",
    ]
    reason: str | None = None
    subtotal_price: int
    discount_amount: int
    total_price: int
    min_order_price: int | None = None
    shortfall: int = 0
    discount_type: ShopDiscountType | None = None
    discount_value: int | None = None
    min_quantity: int | None = None
    quantity_shortfall: int = 0
    target_products: list[ShopPromotionProductTargetOut] = Field(default_factory=list)
    product_price_overrides: list[ShopPromotionProductPriceOut] = Field(default_factory=list)


class OrderCancelRequest(BaseModel):
    reason: str | None = Field(None, max_length=500, description="取消原因")


class OrderPaymentUpdate(BaseModel):
    is_paid: bool = Field(..., description="是否已繳費")


class ClassPaymentUpdate(BaseModel):
    is_paid: bool = Field(description="班聯會是否已收到款項")
    activity_id: uuid.UUID | None = Field(description="本次更新的活動；null 代表一般商品")


class ClassReceiptBatchCreate(BaseModel):
    activity_id: uuid.UUID | None = Field(description="收據活動；null 代表一般商品")
    class_ids: list[uuid.UUID] | None = Field(
        default=None,
        min_length=1,
        max_length=200,
        description="指定班級；未提供時依匯出選項選取班級",
    )
    unpaid_only: bool = Field(
        default=False,
        description="僅匯出尚未由班聯確認收款的班級；只適用於未指定班級時",
    )


class ChangedOrderReceiptCreate(BaseModel):
    activity_id: uuid.UUID | None = Field(description="收據活動；null 代表一般商品")


class ClassCollectionUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    is_class_collected: bool = Field(..., description="班代是否已向此學生收款（僅供班級紀錄）")


class ClassPaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    class_id: uuid.UUID
    activity_id: uuid.UUID | None = None
    updated_orders: int
    is_paid: bool


class ClassPaymentReportItemOut(BaseModel):
    class_id: uuid.UUID
    class_label: str
    grade: int
    activity_id: uuid.UUID | None = None
    activity_label: str
    confirmed_at: datetime
    amount: int
    order_count: int


class ShopPromotionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    activity_id: uuid.UUID | None = Field(None, description="適用活動；未指定時僅適用一般商品")
    target_email: str | None = Field(None, max_length=255, description="指定帳號 Email")
    target_identifiers: list[str] = Field(
        default_factory=list,
        max_length=500,
        description="可使用優惠的帳號 Email 或學號",
    )
    target_product_ids: list[uuid.UUID] = Field(
        default_factory=list,
        max_length=100,
        description="優惠適用商品；套組為每項各一件，一般折扣要求同時登記，指定商品價格可任選",
    )
    product_price_overrides: list[ShopPromotionProductPriceCreate] = Field(
        default_factory=list,
        max_length=100,
        description="指定商品價格優惠的商品與優惠後單價",
    )
    code: str | None = Field(None, max_length=80, description="優惠碼；留空時符合條件即自動套用")
    discount_type: ShopDiscountType
    discount_value: int = Field(
        ..., ge=0, description="百分比、固定折抵金額或每套組合價；指定商品價格時填 0"
    )
    min_order_price: int = Field(0, ge=0)
    min_quantity: int = Field(1, ge=1, le=100)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_uses: int | None = Field(None, ge=1)
    description: str | None = Field(None, max_length=500)
    is_public: bool = True


class ShopPromotionUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    activity_id: uuid.UUID | None = Field(None, description="適用活動；未指定時僅適用一般商品")
    target_email: str | None = Field(None, max_length=255)
    target_identifiers: list[str] | None = Field(None, max_length=500)
    target_product_ids: list[uuid.UUID] | None = Field(None, max_length=100)
    product_price_overrides: list[ShopPromotionProductPriceCreate] | None = Field(
        None, max_length=100, description="指定商品價格優惠的商品與優惠後單價"
    )
    code: str | None = Field(None, max_length=80)
    discount_type: ShopDiscountType | None = None
    discount_value: int | None = Field(None, ge=0)
    min_order_price: int | None = Field(None, ge=0)
    min_quantity: int | None = Field(None, ge=1, le=100)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_uses: int | None = Field(None, ge=1)
    description: str | None = Field(None, max_length=500)
    is_active: bool | None = None
    is_public: bool | None = None

    @field_validator("is_public")
    @classmethod
    def reject_null_public_visibility(cls, value: bool | None) -> bool:
        if value is None:
            raise ValueError("優惠公開狀態不可為空")
        return value

    @field_validator("discount_value")
    @classmethod
    def reject_null_discount_value(cls, value: int | None) -> int:
        if value is None:
            raise ValueError("優惠折扣數值不可為空")
        return value

    @field_validator("discount_type")
    @classmethod
    def reject_null_discount_type(cls, value: ShopDiscountType | None) -> ShopDiscountType:
        if value is None:
            raise ValueError("優惠內容不可為空")
        return value


class ShopPromotionTargetOut(BaseModel):
    email: str | None = None
    student_id: str | None = None


class ShopPromotionProductTargetOut(BaseModel):
    id: uuid.UUID
    name: str


class ShopPromotionPublicOut(BaseModel):
    id: uuid.UUID
    name: str
    activity_id: uuid.UUID | None = None
    code: str | None = None
    discount_type: ShopDiscountType
    discount_value: int
    min_order_price: int
    min_quantity: int
    target_products: list[ShopPromotionProductTargetOut] = Field(default_factory=list)
    product_price_overrides: list[ShopPromotionProductPriceOut] = Field(default_factory=list)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    description: str | None = None


class ShopPromotionOut(BaseModel):
    id: uuid.UUID
    name: str
    activity_id: uuid.UUID | None = None
    code: str | None = None
    target_user_id: uuid.UUID | None = None
    target_email: str | None = None
    target_users: list[ShopPromotionTargetOut] = Field(default_factory=list)
    target_products: list[ShopPromotionProductTargetOut] = Field(default_factory=list)
    product_price_overrides: list[ShopPromotionProductPriceOut] = Field(default_factory=list)
    discount_type: ShopDiscountType
    discount_value: int
    min_order_price: int
    min_quantity: int
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_uses: int | None = None
    used_count: int
    is_active: bool
    is_public: bool
    description: str | None = None
    created_at: datetime
    updated_at: datetime


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


class ShopOrdersClearOut(BaseModel):
    deleted_order_count: int


class ShopClassProductSummaryRow(BaseModel):
    product_id: uuid.UUID
    product_name: str
    quantity: int
    total_amount: int
    collected_order_count: int = 0
    uncollected_order_count: int = 0
    collected_quantity: int = 0
    uncollected_quantity: int = 0
    collected_amount: int = 0
    uncollected_amount: int = 0


class ShopClassSummaryOut(BaseModel):
    class_count: int = 0
    order_count: int = 0
    item_count: int = 0
    total_amount: int = 0
    paid_amount: int = 0
    unpaid_amount: int = 0
    paid_order_count: int = 0
    unpaid_order_count: int = 0
    assisted_order_count: int = 0
    product_rows: list[ShopClassProductSummaryRow] = []


class ImageUploadOut(BaseModel):
    url: str


# ── 結單 ──────────────────────────────────────────────────────────────────────


class ShopOrderCloseCreate(BaseModel):
    class_id: uuid.UUID | None = None
    notes: str | None = None
    closes_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def validate_deadline_scope(self) -> Self:
        if self.class_id is None and self.closes_at is not None:
            raise ValueError("班聯統一截止時間請在活動設定調整")
        return self


class ShopOrderCloseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category_id: uuid.UUID
    class_id: uuid.UUID | None
    closed_by_name: str | None = None
    closed_at: datetime
    closes_at: datetime | None = None
    reopened_at: datetime | None
    notes: str | None
    is_active: bool


class CloseStatusItem(BaseModel):
    is_closed: bool
    is_global: bool = False
    closes_at: datetime | None = None
    closed_at: datetime | None = None
    closed_by_name: str | None = None
    class_collected_at: datetime | None = None
    council_confirmed_at: datetime | None = None


class CloseStatusOut(BaseModel):
    statuses: dict[str, CloseStatusItem]


# ── 商品規格數量彙總 ────────────────────────────────────────────────────────────


class ShopDelegationContextOut(BaseModel):
    link: ShopDelegationOut
    student_name: str
    can_claim: bool
    can_edit: bool
    registration: OrderOut | None = None
    catalog: list[CatalogCategoryOut] = Field(default_factory=list)
    promotions: list[ShopPromotionPublicOut] = Field(default_factory=list)
    closed_category_ids: list[uuid.UUID] = Field(default_factory=list)


class OrderQuantityRow(BaseModel):
    product_id: uuid.UUID
    product_name: str
    series_name: str
    variant_key: str
    qty_total: int
    qty_paid: int


__all__ = [
    "CartItemCreate",
    "CartItemOut",
    "CartItemUpdate",
    "CartOut",
    "CatalogCategoryOut",
    "CatalogProductOut",
    "CatalogSeriesOut",
    "CheckoutRequest",
    "CurrentRegistrationUpdate",
    "ImageUploadOut",
    "OrderCancelRequest",
    "OrderCreate",
    "OrderItemCreate",
    "RegistrationVariantCreate",
    "OrderItemOut",
    "OrderListItem",
    "OrderOut",
    "ShopDelegatedOrderOut",
    "OrderPaymentUpdate",
    "ClassPaymentUpdate",
    "ClassCollectionUpdate",
    "ClassPaymentOut",
    "ClassPaymentReportItemOut",
    "OrderSummaryOut",
    "OrderSummaryRow",
    "ShopOrdersClearOut",
    "ProductCategoryCreate",
    "ProductCategoryOut",
    "ProductCategoryUpdate",
    "ProductCreate",
    "ProductMediaCreate",
    "ProductMediaOut",
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
    "ShopClassProductSummaryRow",
    "ShopClassSummaryOut",
    "ShopOrderCloseCreate",
    "ShopOrderCloseOut",
    "ShopPromotionProductPriceCreate",
    "ShopPromotionProductPriceOut",
    "CloseStatusItem",
    "CloseStatusOut",
    "OrderQuantityRow",
]
