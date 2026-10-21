"""依班級與活動產生班聯會收款簽收單。"""

from __future__ import annotations

import asyncio
import html
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import local_today
from api.models.activity import Activity
from api.models.school_class import SchoolClass
from api.models.shop import Order, OrderItem, OrderStatus
from api.services.official_print import _font_faces, render_print_pdf


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

    rows = []
    subtotal = 0
    for (_, unit_price, options), (name, quantity) in grouped.items():
        amount = unit_price * quantity
        subtotal += amount
        remarks = "、".join(f"{group}：{value}" if group else value for group, value in options)
        rows.append(
            f"<tr><td>{html.escape(name)}</td><td class='number'>{quantity:,}</td>"
            f"<td class='number'>{unit_price:,}</td><td class='number'>{amount:,}</td>"
            f"<td>{html.escape(remarks)}</td></tr>"
        )
    total = sum(order.total_price for order in orders)
    discount = subtotal - total
    copies = []
    for copy_name in ("收執聯", "存根聯"):
        copies.append(f"""
<section class="receipt">
  <h1>新竹高中班聯會收據 — {copy_name}</h1>
  <p>買受人：{html.escape(class_label)}（{academic_year} 學年度）</p>
  <p>活動：{html.escape(activity_name)}</p>
  <p>開立日期：中華民國 {issued_on.year - 1911} 年 {issued_on.month} 月 {issued_on.day} 日</p>
  <table>
    <colgroup><col style="width:30%"><col style="width:10%"><col style="width:15%">
      <col style="width:18%"><col style="width:27%"></colgroup>
    <thead><tr><th>品名</th><th>數量</th><th>單價</th><th>金額</th><th>備註／規格</th></tr></thead>
    <tbody>{"".join(rows)}</tbody>
  </table>
  <div class="closing">
    <p class="totals">商品金額：NT$ {subtotal:,}　優惠折抵：NT$ {discount:,}</p>
    <p class="total">總金額：新台幣 {total:,} 元整</p>
    <p class="note">本單包含本班此活動班聯已確認收款的 {len(orders)} 筆有效訂單。</p>
    <div class="signatures"><span>繳款人簽名：________________</span>
      <span>班聯收款人簽名：________________</span></div>
  </div>
</section>""")
    markup = f"""<!doctype html><html lang="zh-TW"><head><meta charset="UTF-8">
<title>班級收款簽收單</title><style>
{_font_faces()}
@page {{ size: A4; margin: 14mm; }}
body {{ font-family: "OfficialKai", serif; color: #000; font-size: 11pt; line-height: 1.4; }}
h1 {{ font-size: 17pt; text-align: center; margin: 0 0 4mm; }}
p {{ margin: 1.5mm 0; overflow-wrap: anywhere; }}
.receipt {{ break-inside: avoid; }}
.receipt + .receipt {{ border-top: 1px dashed #555; margin-top: 8mm; padding-top: 8mm; }}
table {{ width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 3mm; }}
thead {{ display: table-header-group; }}
tr {{ break-inside: avoid; }}
th, td {{ border: 1px solid #000; padding: 2mm; overflow-wrap: anywhere; }}
th {{ font-weight: bold; text-align: center; }}
.number {{ text-align: right; }}
.closing {{ break-inside: avoid; }}
.totals {{ text-align: right; }}
.total {{ text-align: right; font-size: 13pt; font-weight: bold; }}
.note {{ font-size: 9pt; }}
.signatures {{ display: flex; justify-content: space-between; margin-top: 6mm; font-size: 10pt; }}
</style></head><body>{"".join(copies)}</body></html>"""
    return render_print_pdf(markup)


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
