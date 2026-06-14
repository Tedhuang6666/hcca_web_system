"""訂單報表匯出"""

from __future__ import annotations

import io
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import Order, OrderItem, Product, ProductCategory, ProductSeries


async def _fetch_order_report_rows(
    session: AsyncSession,
    activity_id: uuid.UUID | None = None,
) -> list[dict]:
    q = (
        select(
            Order.serial_number.label("訂單字號"),
            Order.status.label("訂單狀態"),
            Order.total_price.label("訂單總金額"),
            Order.is_paid.label("是否已繳費"),
            Order.created_at.label("建立時間"),
            OrderItem.quantity.label("數量"),
            OrderItem.unit_price.label("單價"),
            Product.name.label("商品名稱"),
        )
        .join(OrderItem, Order.id == OrderItem.order_id)
        .join(Product, OrderItem.product_id == Product.id)
        .order_by(Order.created_at.desc())
    )
    if activity_id:
        q = q.where(
            Product.series.has(
                ProductSeries.category.has(ProductCategory.activity_id == activity_id)
            )
        )

    result = await session.execute(q)
    rows = result.mappings().all()
    return [
        {
            "訂單字號": r["訂單字號"],
            "訂單狀態": r["訂單狀態"].value if hasattr(r["訂單狀態"], "value") else r["訂單狀態"],
            "是否已繳費": "是" if r["是否已繳費"] else "否",
            "商品名稱": r["商品名稱"],
            "數量": r["數量"],
            "單價（NT$）": r["單價"],
            "小計（NT$）": r["數量"] * r["單價"],
            "訂單總金額（NT$）": r["訂單總金額"],
            "建立時間": r["建立時間"].strftime("%Y-%m-%d %H:%M:%S") if r["建立時間"] else "",
        }
        for r in rows
    ]


async def export_orders_excel(
    session: AsyncSession,
    activity_id: uuid.UUID | None = None,
) -> bytes:
    import pandas as pd

    rows = await _fetch_order_report_rows(session, activity_id=activity_id)
    columns = [
        "訂單字號",
        "訂單狀態",
        "是否已繳費",
        "商品名稱",
        "數量",
        "單價（NT$）",
        "小計（NT$）",
        "訂單總金額（NT$）",
        "建立時間",
    ]
    df = pd.DataFrame(rows) if rows else pd.DataFrame(columns=columns)

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="訂單報表")
        ws = writer.sheets["訂單報表"]
        for col in ws.columns:
            max_len = max((len(str(cell.value or "")) for cell in col), default=10)
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 4, 50)

    return buf.getvalue()


async def export_orders_csv(
    session: AsyncSession,
    activity_id: uuid.UUID | None = None,
) -> str:
    import pandas as pd

    rows = await _fetch_order_report_rows(session, activity_id=activity_id)
    df = pd.DataFrame(rows) if rows else pd.DataFrame()
    return df.to_csv(index=False, encoding="utf-8-sig")
