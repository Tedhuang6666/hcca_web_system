"""依班級與活動產生班聯會收款簽收單。"""

from __future__ import annotations

import asyncio
import html
import unicodedata
import uuid
from datetime import date
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import local_today
from api.models.activity import Activity
from api.models.school_class import SchoolClass
from api.models.shop import Order, OrderItem, OrderStatus
from api.services.official_print import _font_faces, render_print_pdf

_RECEIPT_TEMPLATE = Path(__file__).with_name("templates") / "class_receipt.pdf"
# 原始 Letter 雙聯表單的座標（pt）；資料以透明文字層填入，不重畫表格或會徽。
_RECEIPT_COLUMNS = ((40, 136), (184, 46), (238, 60), (306, 100), (414, 158))
_RECEIPT_ROW_TOPS = (159.1, 182.0, 204.9, 228.0, 250.9, 273.9, 296.9)
_RECEIPT_COPY_OFFSET = 345.77


def _receipt_text_lines(value: str, width: float, font_size: float = 9) -> list[str]:
    """依字寬保守換行，長品名與規格接續到下一列，避免壓到原表格線。"""
    lines: list[str] = []
    for paragraph in value.split("\n"):
        line = ""
        used = 0.0
        for char in paragraph:
            char_width = font_size * (1 if unicodedata.east_asian_width(char) in "WF" else 0.65)
            if line and used + char_width > width:
                lines.append(line)
                line, used = "", 0.0
            line += char
            used += char_width
        lines.append(line)
    return lines


def _receipt_field(
    value: str, x: float, y: float, width: float, *, font_size: float = 9, align: str = "left"
) -> str:
    escaped = html.escape(value).replace("\n", "<br>")
    return (
        f'<div class="field" style="left:{x}pt;top:{y}pt;width:{width}pt;'
        f'font-size:{font_size}pt;text-align:{align}">{escaped}</div>'
    )


def _render_class_receipt_pdf(
    class_label: str,
    academic_year: int,
    activity_name: str,
    orders: list[Order],
    issued_on: date,
) -> bytes:
    # 同商品、規格與成交單價合併；金額只使用訂單快照，不依目前商品價格重算。
    grouped: dict[tuple[uuid.UUID, int, tuple[tuple[str, str], ...]], tuple[str, int]] = {}
    for order in orders:
        for item in order.items:
            options = tuple(
                sorted(
                    (str(option.get("group_name", "")), str(option.get("value", "")))
                    for option in item.selected_options
                )
            )
            key = (item.product_id, item.unit_price, options)
            name, quantity = grouped.get(key, (item.product.name, 0))
            grouped[key] = (name, quantity + item.quantity)

    rows: list[tuple[str, str, str, str, str]] = []
    subtotal = 0
    for (_, unit_price, options), (name, quantity) in grouped.items():
        amount = unit_price * quantity
        subtotal += amount
        remarks = "、".join(f"{group}：{value}" if group else value for group, value in options)
        if not rows:
            remarks = f"{activity_name}\n{remarks}".rstrip()
        names = _receipt_text_lines(name, _RECEIPT_COLUMNS[0][1])
        notes = _receipt_text_lines(remarks, _RECEIPT_COLUMNS[4][1])
        for index in range(0, max(len(names), len(notes)), 2):
            rows.append(
                (
                    "\n".join(names[index : index + 2]),
                    f"{quantity:,}" if index == 0 else "",
                    f"{unit_price:,}" if index == 0 else "",
                    f"{amount:,}" if index == 0 else "",
                    "\n".join(notes[index : index + 2]),
                )
            )
    total = sum(order.total_price for order in orders)
    discount = subtotal - total
    if discount:
        rows.append(("優惠折抵", "", "", f"{-discount:,}", ""))
    page_count = max(1, (len(rows) + 6) // 7)
    sections = []
    for page_index in range(page_count):
        fields = []
        for offset in (0.0, _RECEIPT_COPY_OFFSET):
            buyer = f"{class_label}（{academic_year} 學年度）"
            buyer_lines = _receipt_text_lines(buyer, 394, font_size=7 if len(buyer) > 45 else 11)
            fields.append(
                _receipt_field(
                    "\n".join(buyer_lines),
                    85,
                    96 + offset,
                    394,
                    font_size=7 if len(buyer) > 45 else 11,
                )
            )
            for value, x, width in (
                (str(issued_on.year - 1911), 121, 22),
                (str(issued_on.month), 162, 17),
                (str(issued_on.day), 198, 17),
            ):
                fields.append(
                    _receipt_field(value, x, 116 + offset, width, font_size=11, align="center")
                )
            page_rows = rows[page_index * 7 : (page_index + 1) * 7]
            for row, y in zip(page_rows, _RECEIPT_ROW_TOPS, strict=False):
                for column, (value, (x, width)) in enumerate(
                    zip(row, _RECEIPT_COLUMNS, strict=True)
                ):
                    fields.append(
                        _receipt_field(
                            value,
                            x,
                            y + offset,
                            width,
                            font_size=7.5 if column in (1, 2, 3) and len(value) > 10 else 9,
                            align="right" if column in (1, 2, 3) else "left",
                        )
                    )
            fields.append(
                _receipt_field(f"{total:,}", 306, 325 + offset, 99, font_size=12, align="right")
            )
            # 範本的大寫欄為六位數；超過時在原有備註區寫完整金額，不截去高位數。
            if 0 <= total < 1_000_000:
                digits = "零壹貳參肆伍陸柒捌玖"
                for digit, x in zip(f"{total:06d}", (59, 118, 177, 236, 295, 354), strict=True):
                    fields.append(
                        _receipt_field(
                            digits[int(digit)], x, 354 + offset, 20, font_size=12, align="center"
                        )
                    )
                page_note = f"第 {page_index + 1}/{page_count} 頁，總額為整份收據合計"
            else:
                page_note = f"第 {page_index + 1}/{page_count} 頁，新台幣 {total:,} 元整"
            fields.append(_receipt_field(page_note, 414, 321 + offset, 158, font_size=8))
            fields.append(_receipt_field("繳款人簽名：____________", 414, 343 + offset, 158))
            fields.append(_receipt_field("班聯收款人簽名：________", 414, 361 + offset, 158))
        sections.append(f'<section class="page">{"".join(fields)}</section>')
    markup = f"""<!doctype html><html lang="zh-TW"><head><meta charset="UTF-8">
<style>
{_font_faces()}
@page {{ size: 612pt 792pt; margin: 0; }}
body {{ margin: 0; font-family: "OfficialKai", serif; color: #000; }}
.page {{ position: relative; width: 612pt; height: 792pt; break-after: page; }}
.field {{ position: absolute; line-height: 10.5pt; overflow-wrap: anywhere; }}
</style></head><body>{"".join(sections)}</body></html>"""
    overlay = PdfReader(BytesIO(render_print_pdf(markup)))
    template = PdfReader(_RECEIPT_TEMPLATE)
    output = PdfWriter()
    for overlay_page in overlay.pages:
        # 各頁獨立複製底版，避免 pypdf 的物件快取讓續頁疊到前一頁內容。
        output.reset_translation(template)
        page = output.add_page(template.pages[0])
        page.merge_page(overlay_page)
    result = BytesIO()
    output.write(result)
    return result.getvalue()


async def export_class_receipt_pdf(
    session: AsyncSession,
    school_class: SchoolClass,
    *,
    activity_id: uuid.UUID | None,
) -> bytes:
    """僅匯出班聯已確認的有效訂單；不受清單篩選或分頁影響，也不修改收款狀態。"""
    activity = await session.get(Activity, activity_id) if activity_id else None
    if activity_id and activity is None:
        raise ValueError("找不到此活動")
    orders = list(
        (
            await session.scalars(
                select(Order)
                .where(
                    Order.class_id == school_class.id,
                    Order.test_product_id.is_(None),
                    Order.activity_id == activity_id
                    if activity_id is not None
                    else Order.activity_id.is_(None),
                    Order.is_paid.is_(True),
                    Order.status.notin_([OrderStatus.CANCELLED, OrderStatus.REFUNDED]),
                )
                .options(selectinload(Order.items).selectinload(OrderItem.product))
                .order_by(Order.created_at, Order.id)
            )
        ).all()
    )
    if not orders:
        raise ValueError("此班此活動尚無班聯已確認收款的有效訂單，請先確認收款")
    return await asyncio.to_thread(
        _render_class_receipt_pdf,
        school_class.label or school_class.class_code,
        school_class.academic_year,
        activity.name if activity else "一般商品",
        orders,
        local_today(),
    )
