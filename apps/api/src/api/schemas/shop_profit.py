"""完整主題的整批採購與盈利分析；金額為新台幣整數。"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from api.schemas.shop_analytics import SalesOut


class ProductProcurementUpdate(BaseModel):
    """PUT 完整替換採購設定；單位成本的 null 代表尚未設定。"""

    model_config = ConfigDict(extra="forbid")

    unit_cost: int | None = Field(..., ge=0, le=2147483647, strict=True)
    minimum_order_quantity: int = Field(0, ge=0, le=1000000, strict=True)
    stock_extra_quantity: int = Field(0, ge=0, le=1000000, strict=True)
    reserve_quantity: int = Field(0, ge=0, le=1000000, strict=True)
    extra_cost: int = Field(0, ge=0, le=2147483647, strict=True)
    note: str = Field("", max_length=2000)


class ShopProfitProduct(SalesOut):
    product_id: UUID
    name: str
    price: int
    plan: ProductProcurementUpdate
    ordered_quantity: int
    revenue: int
    paid_amount: int
    purchase_quantity: int
    minimum_top_up_quantity: int
    sellable_stock_quantity: int
    order_cost: int | None
    inventory_cost: int | None
    reserve_cost: int | None
    total_cost: int | None
    profit_amount: int | None
    cash_balance: int | None


class ShopProfitSummary(SalesOut):
    ordered_quantity: int = 0
    purchase_quantity: int = 0
    sellable_stock_quantity: int = 0
    reserve_quantity: int = 0
    minimum_top_up_quantity: int = 0
    revenue: int = 0
    paid_amount: int = 0
    unpaid_amount: int = 0
    extra_cost: int = 0
    missing_cost_product_count: int = 0
    order_cost: int | None = 0
    inventory_cost: int | None = 0
    reserve_cost: int | None = 0
    total_cost: int | None = 0
    profit_amount: int | None = 0
    cash_balance: int | None = 0


class ShopProfitOut(SalesOut):
    category_id: UUID
    category_name: str
    generated_at: datetime
    summary: ShopProfitSummary
    products: list[ShopProfitProduct]
