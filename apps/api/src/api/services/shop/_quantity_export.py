"""商品總量採購表：尺寸販賣數量、商品層級囤貨與目前設定成本。"""

import asyncio
import uuid
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from itertools import product as combinations
from math import prod

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.shop import (
    Order,
    OrderStatus,
    Product,
    ProductStatus,
    ProductVariantGroup,
)
from api.services.shop._costs import option_unit_cost, selected_cost_options
from api.services.shop._order_queries import load_quantity_orders
from api.services.shop._ordering import product_catalog_ordering
from api.services.shop._orders import _product_category_filter

MAX_VARIANT_COMBINATIONS = 500


@dataclass
class QuantityDetail:
    label: str
    unit_cost: int | None
    quantity: int = 0


def _detail(product: Product, snapshots: list[dict]) -> tuple[tuple[str, ...], QuantityDetail]:
    options = selected_cost_options(snapshots)
    ordered = sorted(options.values(), key=lambda option: str(option.get("group_name", "")))
    label = (
        str(ordered[0].get("value", ""))
        if len(ordered) == 1
        else " / ".join(
            f"{option.get('group_name', '')}：{option.get('value', '')}" for option in ordered
        )
    )
    costs = [
        product.unit_cost,
        *(option_unit_cost(product, key, snapshot) for key, snapshot in options.items()),
    ]
    cost = None if None in costs else sum(value for value in costs if value is not None)
    return tuple(sorted(options)), QuantityDetail(label, cost)


def render_quantity_excel(products: list[Product], orders: list[Order]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "訂單統計詳情"
    sheet.append(["商品", "尺寸", "販賣", "囤貨", "總量", "商品總量", "價格(成本)", "總價"])
    by_product = {product.id: product for product in products}
    rows: dict[uuid.UUID, dict[tuple[str, ...], QuantityDetail]] = {}
    stock_costs: dict[uuid.UUID, set[int | None]] = {}
    for product in products:
        groups = [
            [option for option in group.options if option.is_active]
            for group in product.variant_groups
        ]
        if prod(len(options) for options in groups) > MAX_VARIANT_COMBINATIONS:
            raise ValueError(
                f"「{product.name}」的規格組合超過 {MAX_VARIANT_COMBINATIONS} 組，請先篩選單一商品或整理規格。"
            )
        details = rows.setdefault(product.id, {})
        costs = stock_costs.setdefault(product.id, set())
        for selected in combinations(*groups):
            key, detail = _detail(
                product,
                [
                    {
                        "option_id": str(option.id),
                        "group_name": group.name,
                        "value": option.value,
                        "price_delta": option.price_delta,
                    }
                    for group, option in zip(product.variant_groups, selected, strict=True)
                ],
            )
            details[key] = detail
            costs.add(detail.unit_cost)
    # 保留已停用、刪除或改名規格的訂單快照；同名不同 ID 的選項不互相合併。
    for order in sorted(orders, key=lambda order: (order.created_at, str(order.id)), reverse=True):
        for item in order.items:
            product = by_product.get(item.product_id)
            if product is None:
                continue
            key, detail = _detail(product, item.selected_options or [])
            details = rows[product.id]
            if key not in details or details[key].quantity == 0:
                details[key] = detail
            details[key].quantity += item.quantity

    for product in products:
        details = list(rows[product.id].values()) or [QuantityDetail("", product.unit_cost)]
        start = sheet.max_row + 1
        end = start + len(details) - 1
        has_variants = bool(product.variant_groups) or any(detail.label for detail in details)
        stock = product.procurement_stock
        costs = stock_costs[product.id] or {product.unit_cost}
        stock_cost = next(iter(costs)) if len(costs) == 1 else None
        for index, detail in enumerate(details):
            number = start + index
            sheet.append(
                [
                    product.name if index == 0 else None,
                    detail.label,
                    detail.quantity,
                    stock if index == 0 else None,
                    f"=C{number}" if has_variants else f"=SUM(C{number}:D{number})",
                    f"=SUM(E{start}:E{end})+D{start}" if has_variants else f"=E{number}",
                    detail.unit_cost if detail.unit_cost is not None else "未設定",
                ]
            )
            # 使用者輸入的商品／規格名稱必須為純文字，避免被 Excel 當作公式。
            for column in (1, 2, 7):
                cell = sheet.cell(number, column)
                if isinstance(cell.value, str):
                    cell.data_type = "s"
        missing = any(detail.quantity and detail.unit_cost is None for detail in details)
        common_cost = details[0].unit_cost
        merge_cost = (
            common_cost is not None
            and all(detail.unit_cost == common_cost for detail in details)
            and (not stock or stock_cost == common_cost)
        )
        if missing or (stock and stock_cost is None):
            sheet.cell(start, 8, "未設定" if missing or None in costs else "囤貨規格成本未定")
        elif merge_cost:
            sheet.cell(start, 8, f"=F{start}*G{start}")
        else:
            sheet.cell(
                start,
                8,
                f"=SUMPRODUCT(C{start}:C{end},G{start}:G{end})"
                + (f"+D{start}*{stock_cost}" if stock else ""),
            )
        if end > start:
            for column in (1, 4, 6, 8, *([7] if merge_cost else [])):
                sheet.merge_cells(
                    start_row=start, end_row=end, start_column=column, end_column=column
                )
        elif not has_variants:
            sheet.merge_cells(start_row=start, end_row=end, start_column=1, end_column=2)

    for row in sheet:
        for cell in row:
            cell.font = Font(name="DFKai-SB", size=12, bold=cell.row == 1)
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            if cell.row > 1:
                cell.number_format = "#,##0"
    for column, width in {
        "A": 28,
        "B": 30,
        "C": 12,
        "D": 12,
        "E": 12,
        "F": 16,
        "G": 18,
        "H": 26,
    }.items():
        sheet.column_dimensions[column].width = width
    sheet.freeze_panes = "C2"
    sheet.print_options.horizontalCentered = True
    sheet.print_title_rows = "1:1"
    sheet.print_area = f"A1:H{sheet.max_row}"
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    workbook.calculation.fullCalcOnLoad = True
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


async def export_quantity_excel(
    session: AsyncSession,
    *,
    grade: int | None = None,
    class_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
    is_paid: bool | None = None,
    status: OrderStatus | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> bytes:
    orders = await load_quantity_orders(
        session,
        grade=grade,
        class_id=class_id,
        category_id=category_id,
        product_id=product_id,
        is_paid=is_paid,
        status=status,
        date_from=date_from,
        date_to=date_to,
    )
    matched_ids = {
        item.product_id
        for order in orders
        for item in order.items
        if (product_id is None or item.product_id == product_id)
        and (
            category_id is None
            or category_id
            in (
                item.product.category_id,
                item.product.series.category_id if item.product.series else None,
            )
        )
    }
    query = (
        select(Product)
        .options(
            selectinload(Product.variant_groups).selectinload(ProductVariantGroup.options),
        )
        .where(
            or_(
                Product.id.in_(matched_ids),
                Product.status.in_(
                    [ProductStatus.ACTIVE, ProductStatus.SOLD_OUT, ProductStatus.CANCELLED]
                ),
            )
        )
    )
    if product_id is not None:
        query = query.where(Product.id == product_id)
    if category_id is not None:
        query = query.where(_product_category_filter(category_id))
    products = list((await session.scalars(query.order_by(*product_catalog_ordering()))).unique())
    return await asyncio.to_thread(render_quantity_excel, products, orders)
