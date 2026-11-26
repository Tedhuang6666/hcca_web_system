"""商品訂購報表 PDF 排版。"""

from __future__ import annotations

import html
import uuid
from collections import defaultdict
from datetime import datetime
from io import BytesIO
from typing import Literal, cast
from zoneinfo import ZoneInfo

from pypdf import PdfReader, PdfWriter

from api.schemas.shop import OrderPurchaseDetailRow, OrderQuantityRow, OrderSummaryOut
from api.services.official_print import _font_faces, render_print_pdf
from api.services.shop._purchase_report import ClassSheetPage, ClassTotalLine, ClassTotalsPage

ReportType = Literal["classes", "people", "class-sheet", "class-totals", "council"]
ReportData = (
    OrderSummaryOut
    | list[OrderPurchaseDetailRow]
    | list[OrderQuantityRow]
    | list[ClassSheetPage]
    | list[ClassTotalsPage]
)

REPORT_LABELS: dict[ReportType, str] = {
    "classes": "各班總數統計",
    "people": "各班個人購買明細",
    "class-sheet": "班級訂購明細",
    "class-totals": "各班總數明細",
    "council": "班聯商品尺寸總表",
}


def _escape(value: object) -> str:
    return html.escape(str(value if value is not None else ""))


def _number(value: int) -> str:
    return f"{value:,}"


def _money(value: int) -> str:
    return f"NT${_number(value)}"


def _table(
    headers: list[str],
    rows: list[list[object]],
    *,
    footer: list[list[object]] | None = None,
    class_name: str = "",
) -> str:
    heading = "".join(f"<th scope='col'>{_escape(value)}</th>" for value in headers)
    body = "".join(
        "<tr>" + "".join(f"<td>{_escape(value)}</td>" for value in row) + "</tr>" for row in rows
    )
    foot = ""
    if footer:
        foot = (
            "<tfoot>"
            + "".join(
                "<tr>" + "".join(f"<th>{_escape(value)}</th>" for value in row) + "</tr>"
                for row in footer
            )
            + "</tfoot>"
        )
    class_attr = f" class='{_escape(class_name)}'" if class_name else ""
    return (
        f"<table{class_attr}><thead><tr>{heading}</tr></thead><tbody>{body}</tbody>{foot}</table>"
    )


def _class_summary(data: OrderSummaryOut) -> str:
    rows = [
        [
            row.label,
            _number(row.order_count),
            _number(row.item_count),
            _money(row.total_amount),
            _money(row.paid_amount),
            _money(row.unpaid_amount),
        ]
        for row in data.rows
    ]
    footer = [
        [
            "合計",
            _number(sum(row.order_count for row in data.rows)),
            _number(sum(row.item_count for row in data.rows)),
            _money(data.total_amount),
            _money(data.paid_amount),
            _money(data.unpaid_amount),
        ]
    ]
    return _table(
        ["班級", "訂單數", "商品件數", "訂購金額", "已確認收款", "待收金額"],
        rows,
        footer=footer,
        class_name="report-table",
    )


def _people_details(rows: list[OrderPurchaseDetailRow]) -> str:
    total = sum(row.quantity for row in rows)
    table_rows = [
        [
            row.class_label,
            row.seat_number if row.seat_number is not None else "",
            row.buyer_label,
            row.product_name,
            row.variant_key,
            _number(row.quantity),
            _number(row.order_count),
        ]
        for row in rows
    ]
    return _table(
        ["班級", "座號", "訂購人", "商品", "尺寸／規格", "數量", "訂單筆數"],
        table_rows,
        footer=[["商品件數合計", "", "", "", "", _number(total), ""]],
        class_name="report-table",
    )


def _class_heading(page: ClassSheetPage | ClassTotalsPage) -> str:
    label = page.class_label.strip()
    academic_year = f"{page.academic_year} 學年度 " if page.academic_year is not None else ""
    if page.grade is not None and page.class_code.isdigit():
        prefix = str(page.grade)
        if page.class_code.startswith(prefix) and len(page.class_code) > len(prefix):
            class_number = int(page.class_code[len(prefix) :])
            if class_number:
                return f"{academic_year}{page.grade} 年 {class_number} 班"
    if academic_year and label.startswith(academic_year.strip()):
        return label
    return f"{academic_year}{label}"


def _class_sheet(pages: list[ClassSheetPage], scope: str) -> str:
    sections: list[str] = []
    for page in pages:
        table_rows = [
            [buyer.seat if buyer.seat is not None else "", buyer.name, "；".join(buyer.items)]
            for buyer in page.buyers
        ]
        sections.append(
            "<section class='class-sheet'>"
            f"<h1>{_escape(scope)}班級訂購明細</h1>"
            f"<p class='class-info'><span class='class-code'>"
            f"{_escape(page.class_code or page.class_label)}</span>"
            f"{_escape(_class_heading(page))}</p>"
            + _table(["座號", "姓名", "訂購數量"], table_rows, class_name="buyer-table")
            + "</section>"
        )
    return "".join(sections) if sections else "<p>目前沒有符合篩選的訂購明細。</p>"


def _class_totals(pages: list[ClassTotalsPage], scope: str) -> str:
    sections: list[str] = []
    for page in pages:
        products: dict[uuid.UUID, list[ClassTotalLine]] = {}
        for line in page.lines:
            products.setdefault(line.product_id, []).append(line)

        rows: list[str] = []
        for product_lines in products.values():
            product_total = sum(line.subtotal for line in product_lines)
            price_runs: dict[int, tuple[int, int]] = {}
            start = 0
            while start < len(product_lines):
                end = start + 1
                while (
                    end < len(product_lines)
                    and product_lines[end].unit_price == product_lines[start].unit_price
                ):
                    end += 1
                price_runs[start] = (end - start, product_lines[start].unit_price)
                start = end

            for index, line in enumerate(product_lines):
                cells = []
                if index == 0:
                    if not line.option_label and len(product_lines) == 1:
                        cells.append(
                            f"<td class='product-cell' colspan='2'>"
                            f"{_escape(line.product_name)}</td>"
                        )
                    else:
                        cells.append(
                            f"<td class='product-cell' rowspan='{len(product_lines)}'>"
                            f"{_escape(line.product_name)}</td>"
                        )
                if line.option_label or len(product_lines) > 1:
                    cells.append(f"<td class='option-cell'>{_escape(line.option_label)}</td>")
                if index in price_runs:
                    rowspan, price = price_runs[index]
                    cells.append(f"<td class='price-cell' rowspan='{rowspan}'>{price}</td>")
                cells.append(f"<td class='quantity-cell'>{line.quantity}</td>")
                if index == 0:
                    cells.append(
                        f"<td class='subtotal-cell' rowspan='{len(product_lines)}'>"
                        f"{product_total}</td>"
                    )
                row_class = "product-last" if index == len(product_lines) - 1 else "variant-row"
                rows.append(f"<tr class='{row_class}'>{''.join(cells)}</tr>")

        title = f"{_class_heading(page)} {scope}班級明細"
        sections.append(
            "<section class='class-total-sheet'>"
            f"<h1>{_escape(title)}</h1>"
            "<table class='class-total-table'><colgroup>"
            "<col><col><col><col><col></colgroup><thead><tr>"
            "<th scope='col'>品項</th><th scope='col'>選項</th><th scope='col'>單價</th>"
            "<th scope='col'>數量</th><th scope='col'>小計</th>"
            f"</tr></thead><tbody>{''.join(rows)}</tbody></table></section>"
        )
    return "".join(sections) if sections else "<p>目前沒有符合篩選的訂購明細。</p>"


def _council_quantities(rows: list[OrderQuantityRow]) -> str:
    grouped: dict[str, list[OrderQuantityRow]] = defaultdict(list)
    for row in rows:
        grouped[str(row.product_id)].append(row)

    body_rows: list[list[object]] = []
    for product_rows in grouped.values():
        total = sum(row.qty_total for row in product_rows)
        paid = sum(row.qty_paid for row in product_rows)
        for row in product_rows:
            body_rows.append(
                [
                    row.product_name,
                    row.variant_key,
                    _number(row.qty_total),
                    _number(row.qty_paid),
                    _number(row.qty_total - row.qty_paid),
                ]
            )
        body_rows.append(
            [
                "商品小計",
                "",
                _number(total),
                _number(paid),
                _number(total - paid),
            ]
        )
    total = sum(row.qty_total for row in rows)
    paid = sum(row.qty_paid for row in rows)
    return _table(
        ["商品", "尺寸／規格", "總數", "已繳件數", "未繳件數"],
        body_rows,
        footer=[["全部商品合計", "", _number(total), _number(paid), _number(total - paid)]],
        class_name="report-table",
    )


def _merge_pdf_documents(documents: list[bytes]) -> bytes:
    writer = PdfWriter()
    for document in documents:
        writer.append(PdfReader(BytesIO(document)), import_outline=False)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def render_order_report_pdf(report_type: ReportType, data: ReportData, scope: str) -> bytes:
    """Render a shop report with the reference table borders and print markers."""
    printed_at = datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y/%m/%d %H:%M")
    if report_type == "class-sheet" and isinstance(data, list) and len(data) > 1:
        class_documents = [
            _render_single_order_report_pdf(report_type, [page], scope, printed_at)
            for page in cast(list[ClassSheetPage], data)
        ]
        return _merge_pdf_documents(class_documents)
    return _render_single_order_report_pdf(report_type, data, scope, printed_at)


def _render_single_order_report_pdf(
    report_type: ReportType,
    data: ReportData,
    scope: str,
    printed_at: str,
) -> bytes:
    if report_type == "classes" and isinstance(data, OrderSummaryOut):
        content = _class_summary(data)
    elif report_type == "people" and isinstance(data, list):
        content = _people_details(cast(list[OrderPurchaseDetailRow], data))
    elif report_type == "class-sheet" and isinstance(data, list):
        content = _class_sheet(cast(list[ClassSheetPage], data), scope)
    elif report_type == "class-totals" and isinstance(data, list):
        content = _class_totals(cast(list[ClassTotalsPage], data), scope)
    elif report_type == "council" and isinstance(data, list):
        content = _council_quantities(cast(list[OrderQuantityRow], data))
    else:
        raise ValueError("報表類型與資料不相符")

    portrait = report_type in {"class-sheet", "class-totals"}
    orientation = "portrait" if portrait else "landscape"
    label = REPORT_LABELS[report_type]
    footer = f"""@bottom-center {{
    content: '{label} · 第 ' counter(page) ' / ' counter(pages) ' 頁 · 列印時間：{printed_at}';
    font-family: OfficialKai, '標楷體', 'DFKai-SB', serif;
    font-size: 8pt;
    color: #666;
  }}"""
    timestamp_footer = f"""@bottom-center {{
    content: '列印時間：{printed_at}';
    font-family: OfficialKai, '標楷體', 'DFKai-SB', serif;
    font-size: 8pt;
    color: #666;
  }}"""
    css = f"""@page {{
  size: A4 {orientation};
  margin: 14mm 12mm 17mm;
  {footer}
}}
@page classSheet {{
  size: A4 portrait;
  margin: 13mm 12mm 17mm;
  @bottom-center {{
    content: string(class-code) ' 第 ' counter(page) ' / ' counter(pages) ' 頁 · 列印時間：{printed_at}';
    font-family: OfficialKai, '標楷體', 'DFKai-SB', serif;
    font-size: 8pt;
    color: #666;
  }}
}}
@page classTotals {{ size: A4 portrait; margin: 25mm 12mm 17mm; {timestamp_footer} }}
* {{ box-sizing: border-box; }}
body {{ font-family: OfficialKai, '標楷體', 'DFKai-SB', serif; color: #000; font-size: 10pt; line-height: 1.4; }}
h1 {{ margin: 0 0 6mm; font-family: OfficialKai, '標楷體', 'DFKai-SB', serif; font-size: 18pt; font-weight: 400; text-align: center; }}
.scope {{ margin: 0 0 7mm; color: #000; }}
.class-info {{ margin: 0 0 2mm; font-size: 12pt; }}
.class-sheet h1 {{ margin-bottom: 4.5mm; }}
.class-sheet .class-info {{ margin-bottom: 1mm; }}
.class-total-sheet h1 {{ margin-bottom: 5mm; }}
.class-code {{ position: absolute; left: -10000px; string-set: class-code content(); }}
.class-sheet {{ page: classSheet; }}
.class-total-sheet {{ page: classTotals; }}
.class-sheet h1, .class-total-sheet h1 {{ font-weight: 700; }}
.class-sheet + .class-sheet, .class-total-sheet + .class-total-sheet {{ break-before: page; }}
table {{ width: 100%; border: 1.5pt solid #000; border-collapse: collapse; table-layout: fixed; font-size: 9pt; }}
thead {{ display: table-header-group; }}
tfoot {{ display: table-footer-group; }}
tr {{ break-inside: avoid; }}
th, td {{ border: 0.5pt solid #000; padding: 3.5pt 5pt; text-align: center; vertical-align: middle; overflow-wrap: anywhere; }}
thead th {{ border-bottom: 1.4pt solid #000; font-weight: 700; }}
tfoot th {{ border-top: 1.1pt solid #000; font-weight: 700; }}
.report-table {{ font-size: 9pt; }}
.buyer-table {{ border-width: 1.6pt; font-size: 10pt; }}
.buyer-table th, .buyer-table td {{ padding: 3.2pt 5pt; }}
.buyer-table tr:first-child > * {{ border-top-width: 1.6pt; }}
.buyer-table tr:last-child > * {{ border-bottom-width: 1.6pt; }}
.buyer-table tr > *:first-child {{ border-left-width: 1.6pt; }}
.buyer-table tr > *:last-child {{ border-right-width: 1.6pt; }}
.buyer-table th:first-child, .buyer-table td:first-child {{ width: 12%; border-right: 0.7pt dotted #000; }}
.buyer-table th:nth-child(2), .buyer-table td:nth-child(2) {{ width: 22%; }}
.buyer-table th:nth-child(3), .buyer-table td:nth-child(3) {{ width: 66%; }}
.class-total-table {{ width: 80%; margin: 0 auto; border-width: 1.6pt; font-size: 10pt; line-height: 1.26; }}
.class-total-table col {{ width: 20%; }}
.class-total-table th, .class-total-table td {{ padding: 2.5pt 4pt; }}
.class-total-table th {{ font-weight: 400; }}
.class-total-table thead th {{ font-weight: 700; }}
.class-total-table thead th {{ border-top-width: 1.6pt; border-bottom-width: 1.2pt; }}
.class-total-table thead th:first-child {{ border-left-width: 1.6pt; }}
.class-total-table thead th:last-child {{ border-right-width: 1.6pt; }}
.class-total-table tbody .product-cell {{ border-left-width: 1.6pt; }}
.class-total-table tbody .subtotal-cell {{ border-right-width: 1.6pt; }}
.class-total-table tbody tr:first-child > * {{ border-top-width: 1.6pt; }}
.class-total-table tbody tr:last-child > * {{ border-bottom-width: 1.6pt; }}
.class-total-table .variant-row .option-cell, .class-total-table .variant-row .quantity-cell {{ border-bottom-width: 0.7pt; border-bottom-style: dotted; }}
.class-total-table .product-last > td {{ border-bottom-width: 1pt; border-bottom-style: solid; }}
"""
    header = ""
    if report_type not in {"class-sheet", "class-totals"}:
        header = f"<h1>（{_escape(scope)}） {label}</h1>"
    markup = (
        "<!doctype html><html lang='zh-TW'><head><meta charset='utf-8'>"
        f"<style>{_font_faces()}{css}</style></head><body>"
        f"{header}{content}</body></html>"
    )
    return render_print_pdf(markup)
