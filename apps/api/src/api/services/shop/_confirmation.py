"""班級訂購總數確認單；列印不影響收據或付款紀錄。"""

from __future__ import annotations

import asyncio
import html
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import TAIPEI, now_local
from api.models.school_class import SchoolClass
from api.models.shop import Order, OrderStatus
from api.services.official_print import _font_faces, render_print_pdf
from api.services.shop._receipts import (
    _receipt_order_options,
    _receipt_order_scope,
    _receipt_products,
    _receipt_variant_summary,
    _resolve_receipt_scope,
)


def _render_class_order_confirmations_pdf(
    classes: list[tuple[SchoolClass, list[Order]]], label: str, printed_at: datetime
) -> bytes:
    sections = []
    for school_class, orders in classes:
        products = _receipt_products(orders)
        rows = "".join(
            f"<tr><td>{html.escape(product.name)}</td>"
            f'<td class="number">{product.quantity:,}</td>'
            f"<td>{html.escape(_receipt_variant_summary(product))}</td>"
            f'<td class="number">{product.amount:,}</td></tr>'
            for product in products
        )
        quantity = sum(product.quantity for product in products)
        subtotal = sum(product.amount for product in products)
        total = sum(order.total_price for order in orders)
        discount = f"<p>優惠折抵：{subtotal - total:,} 元</p>" if subtotal != total else ""
        sections.append(
            "<section><h1>班級訂購總數確認單</h1>"
            f"<h2>{html.escape(school_class.label or school_class.class_code)}"
            f"（{school_class.academic_year} 學年度）</h2>"
            f"<p>{html.escape(label)}</p>"
            '<table><colgroup><col style="width:30%"><col style="width:12%">'
            '<col style="width:40%"><col style="width:18%"></colgroup>'
            "<thead><tr><th>品項</th><th>總數</th><th>規格數量</th><th>金額（元）</th>"
            f"</tr></thead><tbody>{rows}</tbody></table>"
            f'<div class="totals"><p>總件數：{quantity:,} 件</p>{discount}'
            f"<p>訂單總額：{total:,} 元</p></div>"
            '<div class="signatures">班級確認人：________________　'
            "核對人：________________<p>確認日期：________ 年 ______ 月 ______ 日</p></div>"
            "</section>"
        )
    timestamp = printed_at.astimezone(TAIPEI).strftime("%Y-%m-%d %H:%M")
    markup = f"""<!doctype html><html lang="zh-TW"><head><meta charset="UTF-8">
<style>
{_font_faces()}
@page {{ size: A4; margin: 12mm;
  @top-left {{ content: "列印時間：{timestamp}"; font-size: 8pt; }}
  @bottom-right {{ content: counter(page) " / " counter(pages); font-size: 8pt; }}
}}
body {{ font-family: "OfficialKai", serif; font-size: 10pt; line-height: 1.3; color: #000; margin: 0; }}
section {{ break-before: page; break-inside: avoid; }} section:first-child {{ break-before: auto; }}
h1 {{ text-align: center; font-size: 18pt; line-height: 1.25; margin: 0 0 4mm; }}
h2 {{ font-size: 13pt; margin: 0 0 2mm; }}
section > p {{ margin: 0 0 3mm; }}
table {{ width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9.5pt; line-height: 1.2; }}
thead {{ display: table-header-group; }}
th, td {{ border: 1px solid #555; padding: 1mm 1.5mm; overflow-wrap: anywhere; }}
th {{ text-align: left; }} tr {{ break-inside: avoid; }}
.number {{ text-align: right; }}
.totals, .signatures {{ break-inside: avoid; margin-top: 4mm; }}
.totals p, .signatures p {{ margin: 1mm 0; }} .signatures {{ line-height: 1.7; }}
</style></head><body>{"".join(sections)}</body></html>"""
    return render_print_pdf(markup)


async def export_class_order_confirmations_pdf(
    session: AsyncSession,
    class_ids: list[uuid.UUID] | None,
    *,
    category_id: uuid.UUID | None = None,
) -> bytes:
    category = await _resolve_receipt_scope(session, category_id=category_id)
    label = category.name if category else "全部商品"
    statement = (
        select(SchoolClass, Order)
        .join(Order, Order.class_id == SchoolClass.id)
        .where(
            Order.test_product_id.is_(None),
            _receipt_order_scope(category_id),
            Order.status.notin_([OrderStatus.CANCELLED, OrderStatus.REFUNDED]),
        )
        .options(*_receipt_order_options())
        .order_by(SchoolClass.class_code, SchoolClass.id, Order.created_at, Order.id)
    )
    if class_ids is not None:
        statement = statement.where(SchoolClass.id.in_(class_ids))
    classes: dict[uuid.UUID, tuple[SchoolClass, list[Order]]] = {}
    for school_class, order in (await session.execute(statement)).all():
        classes.setdefault(school_class.id, (school_class, []))[1].append(order)
    if not classes:
        raise ValueError("尚無班級有效訂單可產生總數確認單")
    return await asyncio.to_thread(
        _render_class_order_confirmations_pdf, list(classes.values()), label, now_local()
    )
