"""按商品、完整選項組合與成交單價整理售票情形，不讀取購買者個資。"""

from dataclasses import dataclass
from itertools import product as combinations
from math import prod
from uuid import UUID

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from api.models.shop import Order, OrderStatus, Product
from api.services.shop._analytics import _sales_options

# 避免多規格商品的笛卡兒積使報表失控；已成交組合始終完整保留。
MAX_ZERO_COMBINATIONS = 500
TABLE_NOTE = (
    "售票情形按下單單價分列，小計為單價乘數量，折抵另列於表尾。"
    "同一商品與細目曾調價時分列，不以平均單價取代。"
    "未售出組合依有有效訂單商品的目前啟用選項補零，"
    f"每種商品最多補列 {MAX_ZERO_COMBINATIONS} 組；超過時僅列成交組合。"
    "總數量包含獨立加購商品，不等同票券張數。"
)


@dataclass
class SalesTableRow:
    product_id: UUID
    product_name: str
    detail: str
    unit_price: int
    quantity: int = 0

    @property
    def subtotal(self) -> int:
        return self.unit_price * self.quantity


def _detail(options: list[tuple[str, str, str, str]]) -> str:
    if not options:
        return "不加購"
    if len(options) == 1:
        return options[0][3]
    return " / ".join(f"{group}：{value}" for _, _, group, value in options)


def build_sales_table(
    orders: list[Order], *, product_id: UUID | None = None, category_id: UUID | None = None
) -> list[SalesTableRow]:
    rows: dict[tuple, SalesTableRow] = {}
    products: dict[UUID, Product] = {}

    def key(identifier, options, price):
        return identifier, tuple(sorted((group, option) for group, option, _, _ in options)), price

    # 依 ID 合併選項，採最近成交的名稱快照；相同名稱的不同商品／選項不混在一起。
    for order in sorted(orders, key=lambda o: (o.created_at, str(o.id)), reverse=True):
        if order.test_product_id or order.status in (OrderStatus.CANCELLED, OrderStatus.REFUNDED):
            continue
        for item in order.items:
            product = item.product
            if product_id is not None and product.id != product_id:
                continue
            if category_id is not None and category_id not in (
                product.category_id,
                product.series.category_id if product.series else None,
            ):
                continue
            products[product.id] = product
            options = _sales_options(item.selected_options or [])
            row = rows.setdefault(
                key(product.id, options, item.unit_price),
                SalesTableRow(product.id, product.name, _detail(options), item.unit_price),
            )
            row.quantity += item.quantity

    # 一個規格群組選一項；零銷量列只使用目前啟用的組合與目前價格。
    for product in products.values():
        groups = [
            [option for option in group.options if option.is_active]
            for group in product.variant_groups
        ]
        if prod(len(group) for group in groups) > MAX_ZERO_COMBINATIONS:
            continue
        for selected in combinations(*groups):
            options = _sales_options(
                [
                    {
                        "group_id": str(option.group_id),
                        "option_id": str(option.id),
                        "group_name": group.name,
                        "value": option.value,
                    }
                    for group, option in zip(product.variant_groups, selected, strict=True)
                ]
            )
            price = product.price + sum(option.price_delta for option in selected)
            rows.setdefault(
                key(product.id, options, price),
                SalesTableRow(product.id, product.name, _detail(options), price),
            )
    return sorted(
        rows.values(),
        key=lambda row: (row.product_name, str(row.product_id), row.unit_price, row.detail),
    )


def add_sales_table(workbook: Workbook, rows: list[SalesTableRow], discount: int) -> None:
    sheet = workbook.create_sheet("售票情形", 0)
    sheet.append(["票種", "細目", "單價", "數量", "小計", "總數量", "總額"])
    groups: dict[UUID, list[SalesTableRow]] = {}
    for row in rows:
        groups.setdefault(row.product_id, []).append(row)
    merges = []
    for entries in groups.values():
        start = sheet.max_row + 1
        count = sum(row.quantity for row in entries)
        amount = sum(row.subtotal for row in entries)
        for index, row in enumerate(entries):
            sheet.append(
                [
                    row.product_name if index == 0 else None,
                    row.detail,
                    row.unit_price,
                    row.quantity,
                    row.subtotal,
                    count if index == 0 else None,
                    amount if index == 0 else None,
                ]
            )
        if len(entries) > 1:
            merges.extend(f"{column}{start}:{column}{sheet.max_row}" for column in "AFG")

    total_row = sheet.max_row + 1
    gross = sum(row.subtotal for row in rows)
    sheet.append(
        [
            "總數量",
            sum(row.quantity for row in rows),
            "總金額（折抵前）" if discount else "總金額",
            None,
            None,
            gross,
        ]
    )
    merges.extend([f"C{total_row}:E{total_row}", f"F{total_row}:G{total_row}"])
    if discount:
        for label, amount in [("折抵", discount), ("折扣後總金額", gross - discount)]:
            sheet.append([None, None, label, None, None, amount])
            index = sheet.max_row
            merges.extend([f"C{index}:E{index}", f"F{index}:G{index}"])

    edge = Side(style="thin", color="909090")
    for cells in sheet:
        for cell in cells:
            if isinstance(cell.value, str):
                cell.data_type = "s"
            cell.font = Font(name="Microsoft JhengHei", size=11, bold=cell.row == 1)
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = Border(left=edge, right=edge, top=edge, bottom=edge)
            if isinstance(cell.value, int):
                cell.number_format = "#,##0"
            if cell.row == 1 or cell.row >= total_row:
                cell.fill = PatternFill("solid", fgColor="E8E8E8")
                cell.font = Font(name="Microsoft JhengHei", size=11, bold=True)
        sheet.row_dimensions[cells[0].row].height = 32
    for region in merges:
        sheet.merge_cells(region)
    for column, width in zip("ABCDEFG", [26, 40, 14, 12, 18, 14, 20], strict=True):
        sheet.column_dimensions[column].width = width
    sheet.freeze_panes = "C2"
    sheet.sheet_view.showGridLines = False
    sheet.print_title_rows = "1:1"
    sheet.print_area = f"A1:G{sheet.max_row}"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
