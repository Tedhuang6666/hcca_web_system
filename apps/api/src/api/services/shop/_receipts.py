"""依班級與活動產生班聯會收款簽收單。"""

from __future__ import annotations

import asyncio
import html
import re
import unicodedata
import uuid
from collections.abc import Iterable
from datetime import date, datetime
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from sqlalchemy import exists, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import TAIPEI, local_today, now_local
from api.models.activity import Activity
from api.models.school_class import SchoolClass
from api.models.shop import Order, OrderItem, OrderStatus
from api.models.shop_class_payment import ShopClassPayment
from api.models.shop_order_receipt_print import ShopOrderReceiptPrint
from api.services.official_print import _font_faces, render_print_pdf

_RECEIPT_TEMPLATE = Path(__file__).with_name("templates") / "class_receipt.pdf"
# 原始 Letter 雙聯表單的座標（pt）；資料以透明文字層填入，不重畫表格或會徽。
_RECEIPT_COLUMNS = ((40, 136), (184, 46), (238, 60), (306, 100), (414, 158))
_RECEIPT_ROW_TOPS = (159.1, 182.0, 204.9, 228.0, 250.9, 273.9, 296.9)
_RECEIPT_COPY_OFFSET = 345.77


def _receipt_text_lines(value: str, width: float, font_size: float = 12) -> list[str]:
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
    value: str,
    x: float,
    y: float,
    width: float,
    *,
    font_size: float = 12,
    align: str = "left",
    height: float = 12,
) -> str:
    escaped = html.escape(value).replace("\n", "<br>")
    return (
        f'<div class="field" style="left:{x}pt;top:{y}pt;width:{width}pt;height:{height}pt;'
        f'font-size:{font_size}pt;text-align:{align}"><div>{escaped}</div></div>'
    )


def _render_class_receipt_pdf(
    class_label: str,
    academic_year: int,
    activity_name: str,
    orders: list[Order],
    issued_on: date,
    printed_at: datetime | None = None,
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
        if not rows and activity_name != "一般商品":
            remarks = f"{activity_name}\n{remarks}".rstrip()
        names = _receipt_text_lines(name, _RECEIPT_COLUMNS[0][1])
        notes = _receipt_text_lines(remarks, _RECEIPT_COLUMNS[4][1])
        for index in range(max(len(names), len(notes))):
            rows.append(
                (
                    names[index] if index < len(names) else "",
                    f"{quantity:,}" if index == 0 else "",
                    f"{unit_price:,}" if index == 0 else "",
                    f"{amount:,}" if index == 0 else "",
                    notes[index] if index < len(notes) else "",
                )
            )
    total = sum(order.total_price for order in orders)
    discount = subtotal - total
    if discount:
        rows.append(("優惠折抵", "", "", f"{-discount:,}", ""))
    # 備註欄只有前五列；其下的合併儲存格整塊留給蓋章。
    pages: list[list[tuple[str, str, str, str, str]]] = [[]]
    for row in rows:
        if len(pages[-1]) == 7 or (len(pages[-1]) >= 5 and row[4]):
            pages.append([])
        pages[-1].append(row)
    page_count = len(pages)
    buyer = class_label
    if not re.search(rf"(?<!\d){academic_year}\s*學年度", buyer):
        buyer = f"{buyer}（{academic_year} 學年度）"
    buyer_font_size = 12
    while buyer_font_size > 7 and len(_receipt_text_lines(buyer, 394, buyer_font_size)) > 1:
        buyer_font_size -= 1
    sections = []
    print_label = (
        (printed_at or now_local()).astimezone(TAIPEI).strftime("列印時間：%Y-%m-%d %H:%M")
    )
    for page_index, page_rows in enumerate(pages):
        fields = []
        fields.append(_receipt_field(print_label, 8, 5, 150, font_size=6.5, height=8))
        for offset in (0.0, _RECEIPT_COPY_OFFSET):
            buyer_lines = _receipt_text_lines(buyer, 394, buyer_font_size)
            fields.append(
                _receipt_field(
                    "\n".join(buyer_lines),
                    85,
                    97.93 + offset,
                    394,
                    font_size=buyer_font_size,
                )
            )
            for value, x, width in (
                (str(issued_on.year - 1911), 121, 22),
                (str(issued_on.month), 162, 17),
                (str(issued_on.day), 198, 17),
            ):
                fields.append(_receipt_field(value, x, 117.61 + offset, width, align="center"))
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
                            font_size=(
                                min(12, width / (len(value) * 0.65))
                                if column in (1, 2, 3) and value
                                else 12
                            ),
                            align="right" if column in (1, 2, 3) else "left",
                            height=22.9,
                        )
                    )
            fields.append(_receipt_field(f"{total:,}", 306, 326.56 + offset, 99, align="right"))
            # 範本的大寫欄為六位數；超過時在表格下方寫完整金額，不截去高位數。
            if 0 <= total < 1_000_000:
                digits = "零壹貳參肆伍陸柒捌玖"
                for digit, x in zip(
                    f"{total:06d}", (58.78, 117.58, 176.41, 235.21, 294.03, 352.83), strict=True
                ):
                    fields.append(
                        _receipt_field(digits[int(digit)], x, 356.32 + offset, 20, align="center")
                    )
                page_note = f"第 {page_index + 1}/{page_count} 頁，總額為整份收據合計"
            else:
                page_note = f"第 {page_index + 1}/{page_count} 頁，新台幣 {total:,} 元整"
            fields.append(_receipt_field(page_note, 36, 380 + offset, 540, font_size=8))
        sections.append(f'<section class="page">{"".join(fields)}</section>')
    markup = f"""<!doctype html><html lang="zh-TW"><head><meta charset="UTF-8">
<style>
{_font_faces()}
@page {{ size: 612pt 792pt; margin: 0; }}
body {{ margin: 0; font-family: "OfficialKai", serif; color: #000; }}
.page {{ position: relative; width: 612pt; height: 792pt; break-after: page; }}
.field {{ position: absolute; display: flex; align-items: center; line-height: 1; }}
.field > div {{ width: 100%; overflow-wrap: anywhere; }}
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
    """匯出單一班級有效訂單；不受收款狀態、清單篩選或分頁影響。"""
    return await export_class_receipts_pdf(session, [school_class], activity_id=activity_id)


async def export_class_receipts_pdf(
    session: AsyncSession,
    school_classes: list[SchoolClass] | None,
    *,
    activity_id: uuid.UUID | None,
    unpaid_only: bool = False,
    printed_at: datetime | None = None,
    record_prints: bool = True,
) -> bytes:
    """依班級順序合併收據，可選擇只匯出尚未確認收款的班級。"""
    activity = await session.get(Activity, activity_id) if activity_id else None
    if activity_id and activity is None:
        raise ValueError("找不到此活動")
    statement = (
        select(SchoolClass, Order)
        .join(Order, Order.class_id == SchoolClass.id)
        .where(
            Order.test_product_id.is_(None),
            Order.activity_id == activity_id
            if activity_id is not None
            else Order.activity_id.is_(None),
            Order.status.notin_([OrderStatus.CANCELLED, OrderStatus.REFUNDED]),
        )
        .options(selectinload(Order.items).selectinload(OrderItem.product))
        .order_by(SchoolClass.class_code, SchoolClass.id, Order.created_at, Order.id)
    )
    if school_classes is not None:
        selected_class_ids = [school_class.id for school_class in school_classes]
        statement = statement.where(Order.class_id.in_(selected_class_ids))
    if unpaid_only:
        paid_scope = select(ShopClassPayment.id).where(
            ShopClassPayment.class_id == SchoolClass.id,
            ShopClassPayment.activity_id.is_not_distinct_from(activity_id),
            ShopClassPayment.is_paid.is_(True),
        )
        statement = statement.where(~paid_scope.exists())
    rows = (await session.execute(statement)).all()
    orders_by_class: dict[uuid.UUID, tuple[SchoolClass, list[Order]]] = {}
    for school_class, order in rows:
        entry = orders_by_class.setdefault(school_class.id, (school_class, []))
        entry[1].append(order)
    if not orders_by_class:
        if unpaid_only:
            raise ValueError("此活動沒有尚未確認收款的班級")
        raise ValueError("此活動尚無有效訂單可產生收據")
    printed_at = printed_at or now_local()

    writer = PdfWriter()
    issued_on = local_today()
    for school_class, orders in orders_by_class.values():
        receipt = await asyncio.to_thread(
            _render_class_receipt_pdf,
            school_class.label or school_class.class_code,
            school_class.academic_year,
            activity.name if activity else "一般商品",
            orders,
            issued_on,
            printed_at,
        )
        for page in PdfReader(BytesIO(receipt)).pages:
            writer.add_page(page)
    result = BytesIO()
    writer.write(result)
    if record_prints:
        await record_order_receipts_printed(
            session,
            (order.id for _, orders in orders_by_class.values() for order in orders),
            printed_at=printed_at,
        )
    return result.getvalue()


async def record_order_receipts_printed(
    session: AsyncSession,
    order_ids: Iterable[uuid.UUID],
    *,
    printed_at: datetime,
) -> None:
    ids = list(dict.fromkeys(order_ids))
    if not ids:
        return
    statement = pg_insert(ShopOrderReceiptPrint).values(
        [{"order_id": order_id, "printed_at": printed_at} for order_id in ids]
    )
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[ShopOrderReceiptPrint.order_id],
            set_={"printed_at": statement.excluded.printed_at},
        )
    )


async def render_individual_order_receipt(
    session: AsyncSession,
    order: Order,
    *,
    printed_at: datetime,
) -> bytes:
    school_class = (
        await session.get(SchoolClass, order.supplement_class_id)
        if order.supplement_class_id
        else None
    )
    buyer_name = order.user.display_name if order.user else "個人訂購人"
    academic_year = printed_at.astimezone(TAIPEI).year - 1911
    if school_class:
        class_label = school_class.label or school_class.class_code
        buyer_name = f"{class_label} {buyer_name} 補收款"
        academic_year = school_class.academic_year
    activity_name = order.activity.name if order.activity else "一般商品"
    return await asyncio.to_thread(
        _render_class_receipt_pdf,
        buyer_name,
        academic_year,
        f"{activity_name} · {order.serial_number}",
        [order],
        local_today(),
        printed_at,
    )


async def export_changed_order_receipts_pdf(
    session: AsyncSession,
    *,
    activity_id: uuid.UUID | None,
) -> bytes:
    """列印上次匯出後新增或更新的班級收據與個人訂單收據。"""
    activity = await session.get(Activity, activity_id) if activity_id else None
    if activity_id and activity is None:
        raise ValueError("找不到此活動")
    changed_item = select(OrderItem.id).where(
        OrderItem.order_id == Order.id,
        OrderItem.updated_at > ShopOrderReceiptPrint.printed_at,
    )
    statement = (
        select(Order)
        .outerjoin(ShopOrderReceiptPrint, ShopOrderReceiptPrint.order_id == Order.id)
        .where(
            Order.test_product_id.is_(None),
            Order.activity_id.is_(None)
            if activity_id is None
            else Order.activity_id == activity_id,
            Order.status.notin_((OrderStatus.CANCELLED, OrderStatus.REFUNDED)),
            or_(
                ShopOrderReceiptPrint.order_id.is_(None),
                Order.updated_at > ShopOrderReceiptPrint.printed_at,
                exists(changed_item),
            ),
        )
        .options(
            selectinload(Order.items).selectinload(OrderItem.product),
            selectinload(Order.user),
            selectinload(Order.activity),
        )
        .order_by(Order.class_id, Order.created_at, Order.id)
    )
    changed_orders = list((await session.scalars(statement)).all())
    changed_orders = [
        order
        for order in changed_orders
        if order.class_id is not None or order.supplement_class_id is None or order.is_paid
    ]
    if not changed_orders:
        raise ValueError("上次列印後沒有變更的有效訂單")
    printed_at = now_local()

    writer = PdfWriter()
    printed_order_ids: list[uuid.UUID] = []
    class_ids = list(dict.fromkeys(order.class_id for order in changed_orders if order.class_id))
    if class_ids:
        school_classes = list(
            (
                await session.scalars(
                    select(SchoolClass)
                    .where(SchoolClass.id.in_(class_ids))
                    .order_by(SchoolClass.class_code, SchoolClass.id)
                )
            ).all()
        )
        receipt = await export_class_receipts_pdf(
            session,
            school_classes,
            activity_id=activity_id,
            printed_at=printed_at,
            record_prints=False,
        )
        for page in PdfReader(BytesIO(receipt)).pages:
            writer.add_page(page)
        class_order_ids = await session.scalars(
            select(Order.id).where(
                Order.class_id.in_(class_ids),
                Order.test_product_id.is_(None),
                Order.activity_id.is_(None)
                if activity_id is None
                else Order.activity_id == activity_id,
                Order.status.notin_((OrderStatus.CANCELLED, OrderStatus.REFUNDED)),
            )
        )
        printed_order_ids.extend(class_order_ids.all())

    for order in changed_orders:
        if order.class_id is not None:
            continue
        receipt = await render_individual_order_receipt(session, order, printed_at=printed_at)
        for page in PdfReader(BytesIO(receipt)).pages:
            writer.add_page(page)
        printed_order_ids.append(order.id)

    result = BytesIO()
    writer.write(result)
    await record_order_receipts_printed(session, printed_order_ids, printed_at=printed_at)
    return result.getvalue()
