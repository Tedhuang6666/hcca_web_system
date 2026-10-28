"""商品銷售分析契約；所有金額均為新台幣整數。"""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SalesOut(BaseModel):
    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class ShopSalesMetrics(SalesOut):
    order_count: int = 0
    buyer_count: int = 0
    item_count: int = 0
    total_amount: int = 0
    paid_amount: int = 0
    unpaid_amount: int = 0
    discount_amount: int = 0
    discounted_order_count: int = 0
    average_order_amount: float = 0
    average_items_per_order: float = 0
    promotion_usage_rate: float = 0
    payment_rate: float = 0
    median_order_amount: float = 0
    average_buyer_amount: float = 0
    repeat_buyer_count: int = 0
    repeat_buyer_rate: float = 0


class ShopSalesRow(SalesOut):
    key: str
    label: str
    order_count: int = 0
    buyer_count: int = 0
    item_count: int = 0
    total_amount: int = 0
    paid_amount: int = 0
    gross_amount: int = 0
    discount_amount: int = 0


class ShopSalesDay(ShopSalesRow):
    cumulative_amount: int = 0


class ShopSalesCrossRow(ShopSalesRow):
    dimension_key: str
    dimension_label: str
    product_id: UUID
    product_name: str


class ShopSalesInsight(SalesOut):
    title: str
    detail: str


class ShopSalesPeriod(SalesOut):
    date_from: date
    date_to: date
    metrics: ShopSalesMetrics
    daily: list[ShopSalesDay] = Field(default_factory=list)
    grades: list[ShopSalesRow] = Field(default_factory=list)
    classes: list[ShopSalesRow] = Field(default_factory=list)
    products: list[ShopSalesRow] = Field(default_factory=list)
    variants: list[ShopSalesRow] = Field(default_factory=list)
    hours: list[ShopSalesRow] = Field(default_factory=list)
    amount_bands: list[ShopSalesRow] = Field(default_factory=list)
    item_bands: list[ShopSalesRow] = Field(default_factory=list)
    sources: list[ShopSalesRow] = Field(default_factory=list)
    weekdays: list[ShopSalesRow] = Field(default_factory=list)
    weekday_hours: list[ShopSalesRow] = Field(default_factory=list)
    statuses: list[ShopSalesRow] = Field(default_factory=list)
    buyer_segments: list[ShopSalesRow] = Field(default_factory=list)
    grade_products: list[ShopSalesCrossRow] = Field(default_factory=list)
    class_products: list[ShopSalesCrossRow] = Field(default_factory=list)


class ShopSalesAnalyticsOut(SalesOut):
    generated_at: datetime
    timezone: str = "Asia/Taipei"
    current: ShopSalesPeriod
    previous: ShopSalesPeriod | None = None
    insights: list[ShopSalesInsight] = Field(default_factory=list)


class ShopSalesReportCreate(BaseModel):
    format: Literal["pdf", "xlsx"] = "pdf"
    date_from: date | None = Field(None, ge=date(2000, 1, 1), le=date(2100, 12, 31))
    date_to: date | None = Field(None, ge=date(2000, 1, 1), le=date(2100, 12, 31))
    activity_id: UUID | None = None
    category_id: UUID | None = None
    product_id: UUID | None = None
    grade: int | None = Field(None, ge=0)
    class_id: UUID | None = None
    is_paid: bool | None = None
