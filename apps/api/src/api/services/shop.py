"""購票 / 校商訂購系統服務層 - 商品管理 / 訂單建立（樂觀鎖）/ 報表匯出"""

from __future__ import annotations

import io
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, text
from sqlalchemy.orm.exc import StaleDataError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.shop import Order, OrderItem, OrderStatus, Product, ProductStatus
from api.schemas.shop import OrderItemCreate, ProductCreate, ProductUpdate

logger = logging.getLogger(__name__)


# ── 序號生成 ──────────────────────────────────────────────────────────────────

async def generate_order_serial(session: AsyncSession) -> str:
    """
    使用 PostgreSQL Sequence 原子性生成訂單字號：ORD-YYYY-NNNNNN。
    Sequence `order_serial_seq` 需在 Alembic migration 中建立。
    """
    result = await session.execute(text("SELECT nextval('order_serial_seq')"))
    seq_val: int = result.scalar_one()
    year = datetime.now(UTC).year
    return f"ORD-{year}-{seq_val:06d}"


# ── 商品 CRUD ─────────────────────────────────────────────────────────────────

async def get_product(session: AsyncSession, product_id: uuid.UUID) -> Product | None:
    result = await session.execute(select(Product).where(Product.id == product_id))
    return result.scalar_one_or_none()


async def list_products(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    status: ProductStatus | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Product]:
    q = select(Product)
    if org_id:
        q = q.where(Product.org_id == org_id)
    if status:
        q = q.where(Product.status == status)
    q = q.order_by(Product.created_at.desc()).limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())


async def create_product(
    session: AsyncSession, *, data: ProductCreate, created_by: uuid.UUID
) -> Product:
    product = Product(
        name=data.name,
        description=data.description,
        price=data.price,
        stock_quantity=data.stock_quantity,
        is_unlimited=data.is_unlimited,
        org_id=data.org_id,
        created_by=created_by,
        sale_start=data.sale_start,
        sale_end=data.sale_end,
        status=ProductStatus.DRAFT,
    )
    session.add(product)
    await session.flush()
    logger.info("商品建立 id=%s name=%s", product.id, product.name)
    return product


async def update_product(
    session: AsyncSession, product: Product, *, data: ProductUpdate
) -> Product:
    if product.status not in (ProductStatus.DRAFT, ProductStatus.ACTIVE):
        raise ValueError(f"商品狀態 {product.status} 不允許編輯")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(product, field, value)
    await session.flush()
    return product


async def activate_product(session: AsyncSession, product: Product) -> Product:
    """上架商品（DRAFT → ACTIVE）"""
    if product.status != ProductStatus.DRAFT:
        raise ValueError("只有草稿狀態的商品可以上架")
    product.status = ProductStatus.ACTIVE
    await session.flush()
    return product


async def deactivate_product(session: AsyncSession, product: Product) -> Product:
    """下架商品（ACTIVE → CANCELLED）"""
    if product.status != ProductStatus.ACTIVE:
        raise ValueError("只有上架中的商品可以下架")
    product.status = ProductStatus.CANCELLED
    await session.flush()
    return product


# ── 訂單 CRUD ─────────────────────────────────────────────────────────────────

async def get_order(session: AsyncSession, order_id: uuid.UUID) -> Order | None:
    result = await session.execute(
        select(Order)
        .options(selectinload(Order.items).selectinload(OrderItem.product))
        .where(Order.id == order_id)
    )
    return result.scalar_one_or_none()


async def list_orders(
    session: AsyncSession,
    *,
    user_id: uuid.UUID | None = None,
    org_id: uuid.UUID | None = None,
    status: OrderStatus | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Order]:
    q = (
        select(Order)
        .options(selectinload(Order.items))
        .order_by(Order.created_at.desc())
    )
    if user_id:
        q = q.where(Order.user_id == user_id)
    if org_id:
        q = q.where(Order.org_id == org_id)
    if status:
        q = q.where(Order.status == status)
    q = q.limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())


async def create_order(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    items: list[OrderItemCreate],
    notes: str | None = None,
) -> Order:
    """
    建立訂單（含庫存扣減）。

    樂觀鎖機制：
    - SQLAlchemy 的 version_id_col 在 UPDATE 時自動加入 WHERE version=:v 條件。
    - 若高並發下兩筆請求同時讀到相同版本，第二筆 flush 時會得到 StaleDataError。
    - Router 層應捕捉 StaleDataError 並回傳 409 Conflict。
    """
    if not items:
        raise ValueError("訂單至少需要一項商品")

    total_price = 0
    order_items: list[dict] = []
    org_id: uuid.UUID | None = None

    for item_req in items:
        # 以 session.get 取得 Product（ORM 追蹤版本）
        product = await session.get(Product, item_req.product_id)
        if product is None:
            raise ValueError(f"找不到商品 {item_req.product_id}")
        if product.status != ProductStatus.ACTIVE:
            raise ValueError(f"商品「{product.name}」不在上架狀態")

        now = datetime.now(UTC)
        if product.sale_start and now < product.sale_start:
            raise ValueError(f"商品「{product.name}」尚未開售")
        if product.sale_end and now > product.sale_end:
            raise ValueError(f"商品「{product.name}」已截止販售")

        if not product.is_unlimited:
            if product.stock_quantity < item_req.quantity:
                raise ValueError(
                    f"商品「{product.name}」庫存不足（剩餘 {product.stock_quantity} 件）"
                )
            # 扣減庫存：觸發樂觀鎖版本遞增
            product.stock_quantity -= item_req.quantity
            if product.stock_quantity == 0:
                product.status = ProductStatus.SOLD_OUT

        subtotal = product.price * item_req.quantity
        total_price += subtotal
        order_items.append(
            {"product": product, "quantity": item_req.quantity, "unit_price": product.price}
        )
        # 確認所有商品屬於同一組織
        if org_id is None:
            org_id = product.org_id
        elif org_id != product.org_id:
            raise ValueError("一張訂單的商品必須屬於同一組織")

    if org_id is None:
        raise ValueError("無法判斷組織")

    serial = await generate_order_serial(session)
    order = Order(
        serial_number=serial,
        user_id=user_id,
        org_id=org_id,
        status=OrderStatus.PENDING,
        total_price=total_price,
        notes=notes,
    )
    session.add(order)
    await session.flush()  # 取得 order.id

    for oi in order_items:
        session.add(OrderItem(
            order_id=order.id,
            product_id=oi["product"].id,
            quantity=oi["quantity"],
            unit_price=oi["unit_price"],
        ))

    await session.flush()
    logger.info("訂單建立 serial=%s total=%d", serial, total_price)
    return order


async def cancel_order(
    session: AsyncSession,
    order: Order,
    *,
    requested_by: uuid.UUID,
    reason: str | None = None,
) -> Order:
    """取消訂單並歸還庫存"""
    if order.user_id != requested_by:
        raise PermissionError("只有訂購人可取消訂單")
    if order.status not in (OrderStatus.PENDING, OrderStatus.CONFIRMED):
        raise ValueError(f"訂單狀態 {order.status} 無法取消")

    # 歸還庫存
    for item in order.items:
        product = await session.get(Product, item.product_id)
        if product and not product.is_unlimited:
            product.stock_quantity += item.quantity
            if product.status == ProductStatus.SOLD_OUT:
                product.status = ProductStatus.ACTIVE

    order.status = OrderStatus.CANCELLED
    if reason:
        order.notes = f"[取消原因] {reason}" + (f"\n{order.notes}" if order.notes else "")
    await session.flush()
    logger.info("訂單取消 serial=%s by=%s", order.serial_number, requested_by)
    return order


# ── 報表匯出 [M-26] ───────────────────────────────────────────────────────────

async def _fetch_order_report_rows(
    session: AsyncSession,
    org_id: uuid.UUID | None = None,
) -> list[dict]:
    """聚合訂單明細資料，供 Pandas 處理"""
    q = (
        select(
            Order.serial_number.label("訂單字號"),
            Order.status.label("訂單狀態"),
            Order.total_price.label("訂單總金額"),
            Order.created_at.label("建立時間"),
            OrderItem.quantity.label("數量"),
            OrderItem.unit_price.label("單價"),
            Product.name.label("商品名稱"),
        )
        .join(OrderItem, Order.id == OrderItem.order_id)
        .join(Product, OrderItem.product_id == Product.id)
        .order_by(Order.created_at.desc())
    )
    if org_id:
        q = q.where(Order.org_id == org_id)

    result = await session.execute(q)
    rows = result.mappings().all()
    return [
        {
            "訂單字號": r["訂單字號"],
            "訂單狀態": r["訂單狀態"].value if hasattr(r["訂單狀態"], "value") else r["訂單狀態"],
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
    org_id: uuid.UUID | None = None,
) -> bytes:
    """
    匯出訂單報表為 Excel（.xlsx）。
    使用 Pandas + Openpyxl 產生格式化試算表。
    """
    import pandas as pd  # 延遲匯入，避免未安裝時影響啟動

    rows = await _fetch_order_report_rows(session, org_id=org_id)
    df = pd.DataFrame(rows) if rows else pd.DataFrame(
        columns=["訂單字號", "訂單狀態", "商品名稱", "數量", "單價（NT$）", "小計（NT$）", "訂單總金額（NT$）", "建立時間"]
    )

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="訂單報表")
        # 自動調整欄寬
        ws = writer.sheets["訂單報表"]
        for col in ws.columns:
            max_len = max((len(str(cell.value or "")) for cell in col), default=10)
            ws.column_dimensions[col[0].column_letter].width = min(max_len + 4, 50)

    return buf.getvalue()


async def export_orders_csv(
    session: AsyncSession,
    org_id: uuid.UUID | None = None,
) -> str:
    """匯出訂單報表為 CSV（UTF-8 with BOM，Excel 可直接開啟）"""
    import pandas as pd

    rows = await _fetch_order_report_rows(session, org_id=org_id)
    df = pd.DataFrame(rows) if rows else pd.DataFrame()
    return df.to_csv(index=False, encoding="utf-8-sig")
