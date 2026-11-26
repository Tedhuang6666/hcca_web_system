"""商品訂購報表 PDF 排版。"""

from __future__ import annotations

import html
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Literal, cast

from api.schemas.shop import OrderPurchaseDetailRow, OrderQuantityRow, OrderSummaryOut
from api.services.official_print import _font_faces, render_print_pdf

ReportType = Literal["classes", "people", "class-sheet", "council"]
ReportData = OrderSummaryOut | list[OrderPurchaseDetailRow] | list[OrderQuantityRow]

REPORT_LABELS: dict[ReportType, str] = {
    "classes": "各班總數統計",
    "people": "各班個人購買明細",
    "class-sheet": "班級訂購明細",
    "council": "班聯商品尺寸總表",
}


@dataclass
class _Buyer:
    name: str
    seat: int | None
    items: list[str] = field(default_factory=list)


@dataclass
class _ClassGroup:
    label: str
    buyers: dict[str, _Buyer] = field(default_factory=dict)


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
    )


def _class_sheet(rows: list[OrderPurchaseDetailRow]) -> str:
    classes: dict[str, _ClassGroup] = {}
    for index, row in enumerate(rows):
        class_key = str(row.class_id) if row.class_id is not None else "unassigned"
        group = classes.setdefault(class_key, _ClassGroup(label=row.class_label))
        buyer_key = str(row.user_id) if row.user_id is not None else f"external-{index}"
        buyer = group.buyers.setdefault(
            buyer_key, _Buyer(name=row.buyer_label, seat=row.seat_number)
        )
        variant = "" if row.variant_key == "—" else f"（{row.variant_key}）"
        buyer.items.append(f"{row.product_name}{variant} × {_number(row.quantity)}")

    sections: list[str] = []
    for class_group in classes.values():
        ordered_buyers = sorted(
            class_group.buyers.values(),
            key=lambda buyer: (
                buyer.seat is None,
                buyer.seat if buyer.seat is not None else 0,
                buyer.name,
            ),
        )
        table_rows = [
            [
                buyer.seat if buyer.seat is not None else "",
                buyer.name,
                "；".join(buyer.items),
            ]
            for buyer in ordered_buyers
        ]
        sections.append(
            "<section class='class-sheet'><h2>"
            f"{_escape(class_group.label)} 數量明細</h2>"
            + _table(["座號", "姓名", "訂購數量"], table_rows, class_name="buyer-table")
            + "</section>"
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
    )


def render_order_report_pdf(report_type: ReportType, data: ReportData, scope: str) -> bytes:
    """Render the selected shop report with repeating table heads and page numbers."""
    if report_type == "classes" and isinstance(data, OrderSummaryOut):
        content = _class_summary(data)
    elif report_type == "people" and isinstance(data, list):
        content = _people_details(cast(list[OrderPurchaseDetailRow], data))
    elif report_type == "class-sheet" and isinstance(data, list):
        content = _class_sheet(cast(list[OrderPurchaseDetailRow], data))
    elif report_type == "council" and isinstance(data, list):
        content = _council_quantities(cast(list[OrderQuantityRow], data))
    else:
        raise ValueError("報表類型與資料不相符")

    orientation = "portrait" if report_type == "class-sheet" else "landscape"
    label = REPORT_LABELS[report_type]
    css = f"""@page {{
  size: A4 {orientation};
  margin: 14mm 12mm 17mm;
  @bottom-center {{ content: '{label} · 第 ' counter(page) ' / ' counter(pages) ' 頁'; font-size: 8pt; color: #666; }}
}}
* {{ box-sizing: border-box; }}
body {{ font-family: 'Noto Sans CJK TC', OfficialKai, sans-serif; color: #171717; font-size: 9pt; line-height: 1.45; }}
h1 {{ margin: 0 0 3mm; font-size: 18pt; }}
.scope {{ margin: 0 0 7mm; color: #444; }}
h2 {{ margin: 0 0 3mm; font-size: 12pt; break-after: avoid; }}
.class-sheet + .class-sheet {{ break-before: page; }}
table {{ width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8.5pt; }}
thead {{ display: table-header-group; }}
tfoot {{ display: table-footer-group; }}
tr {{ break-inside: avoid; }}
th, td {{ border: 0.5pt solid #777; padding: 4pt 5pt; text-align: left; vertical-align: top; overflow-wrap: anywhere; }}
thead th, tfoot th {{ background: #f2efe7; font-weight: 700; }}
.buyer-table th:first-child, .buyer-table td:first-child {{ width: 12%; text-align: center; }}
.buyer-table th:nth-child(2), .buyer-table td:nth-child(2) {{ width: 22%; }}
.buyer-table th:nth-child(3), .buyer-table td:nth-child(3) {{ width: 66%; }}
"""
    markup = (
        "<!doctype html><html lang='zh-TW'><head><meta charset='utf-8'>"
        f"<style>{_font_faces()}{css}</style></head><body>"
        f"<h1>{_escape(label)}</h1><p class='scope'>報表範圍：{_escape(scope)}</p>"
        f"{content}</body></html>"
    )
    return render_print_pdf(markup)
