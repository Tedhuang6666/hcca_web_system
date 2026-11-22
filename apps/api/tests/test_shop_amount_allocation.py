"""純金額計算回歸，不連接資料庫；贈品折抵不得攤到付費商品。"""

from datetime import UTC, date, datetime
from uuid import UUID

import pytest

from api.models.shop import Order, OrderItem, OrderStatus, Product
from api.services.shop._analytics import _allocate_amounts, _summarize


@pytest.mark.parametrize(
    ("lines", "discount", "expected"),
    [
        ([(1, 350, 0), (1, 100, 100)], 100, [350, 0]),
        ([(1, 350, 0), (1, 105, 100)], 100, [350, 5]),
        ([(1, 350, 0), (3, 100, 100)], 100, [350, 200]),
        ([(1, 350, 0), (1, 100, 100)], 150, [300, 0]),
        ([(2, 100, 0), (1, 100, 0)], 50, [167, 83]),
        ([(1, 0, 0), (1, 350, 0)], 0, [0, 350]),
        ([(1, 100, 100), (1, 200, 200)], 300, [0, 0]),
        ([(1, 100, None), (1, 100, None)], 1, [100, 99]),
        ([], 0, []),
    ],
)
def test_revenue_respects_gift_snapshots_and_conserves_order_total(lines, discount, expected):
    items = [
        OrderItem(
            id=UUID(int=index + 1),
            quantity=quantity,
            unit_price=price,
            gift_discount_amount=gift_discount,
        )
        for index, (quantity, price, gift_discount) in enumerate(lines)
    ]
    subtotal = sum(item.quantity * item.unit_price for item in items)
    order = Order(
        items=items,
        subtotal_price=subtotal,
        discount_amount=discount,
        total_price=subtotal - discount,
    )
    amounts = _allocate_amounts(order)
    assert [amounts[item.id] for item in items] == expected
    assert sum(amounts.values()) == order.total_price
    assert all(amount >= 0 for amount in amounts.values())
    order.items = list(reversed(items))
    assert _allocate_amounts(order) == amounts


@pytest.mark.parametrize("paid", [True, False])
def test_sales_profit_and_category_filters_keep_gift_revenue_zero(paid):
    ticket = Product(id=UUID(int=10), name="舞會票券", category_id=UUID(int=11), unit_cost=100)
    gift = Product(id=UUID(int=20), name="贈品", category_id=UUID(int=21), unit_cost=20)
    order = Order(
        id=UUID(int=30),
        user_id=UUID(int=31),
        created_at=datetime(2026, 11, 12, tzinfo=UTC),
        status=OrderStatus.CONFIRMED,
        assistance_scope="self",
        is_paid=paid,
        subtotal_price=450,
        discount_amount=100,
        total_price=350,
        items=[
            OrderItem(
                id=UUID(int=1),
                product=ticket,
                product_id=ticket.id,
                quantity=1,
                unit_price=350,
                gift_discount_amount=0,
            ),
            OrderItem(
                id=UUID(int=2),
                product=gift,
                product_id=gift.id,
                quantity=1,
                unit_price=100,
                gift_discount_amount=100,
            ),
        ],
    )
    day = date(2026, 11, 12)
    result = _summarize([order], day, day, None, None)
    rows = {row.key: row for row in result.products}
    assert rows[str(ticket.id)].total_amount == 350
    assert rows[str(ticket.id)].profit_amount == 250
    assert rows[str(gift.id)].total_amount == 0
    assert rows[str(gift.id)].profit_amount == -20
    for product, gross, discount in [(ticket, 350, 0), (gift, 100, 100)]:
        row = rows[str(product.id)]
        assert row.gross_amount == gross
        assert row.discount_amount == discount
        assert row.paid_amount == (row.total_amount if paid else 0)
        assert row.gross_amount == row.total_amount + row.discount_amount
        filtered = _summarize([order], day, day, None, product.category_id)
        assert filtered.metrics.total_amount == row.total_amount
        assert filtered.metrics.profit_amount == row.profit_amount
        assert filtered.metrics.discount_amount == discount
        assert filtered.metrics.item_count == 1
    assert result.metrics.total_amount == 350
    assert result.metrics.discount_amount == 100
    assert result.metrics.profit_amount == 230
