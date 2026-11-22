"""Split uncollected registrations by their catalog activity/category.

Revision ID: 20261009230000
Revises: d3f7b2a91c6e

Paid, collected, reconciled and seated orders retain their historical identity.
Store the fallback category scope. No inventory is reserved again; item IDs, price/variant snapshots and totals survive.
"""

from __future__ import annotations

import uuid
from collections import defaultdict

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine import Connection

revision = "20261009230000"
down_revision = "d3f7b2a91c6e"
branch_labels = None
depends_on = None


def _allocate(amount: int, weights: list[int]) -> list[int]:
    total = sum(weights)
    if not total:
        return [amount, *([0] * (len(weights) - 1))]
    parts = [amount * weight // total for weight in weights]
    remainder_order = sorted(range(len(weights)), key=lambda i: -(amount * weights[i] % total))
    for index in remainder_order[: amount - sum(parts)]:
        parts[index] += 1
    return parts


def _split_uncollected_orders(connection: Connection) -> int:
    metadata = sa.MetaData()
    metadata.reflect(
        connection,
        only=[
            "orders",
            "order_items",
            "products",
            "product_categories",
            "product_series",
            "receivables",
            "shop_order_promotions",
            "shop_promotions",
            "seat_assignments",
            "activity_links",
        ],
    )
    (
        orders,
        items,
        products,
        categories,
        series,
        receivables,
        discounts,
        promotions,
        seats,
        links,
    ) = (
        metadata.tables[name]
        for name in [
            "orders",
            "order_items",
            "products",
            "product_categories",
            "product_series",
            "receivables",
            "shop_order_promotions",
            "shop_promotions",
            "seat_assignments",
            "activity_links",
        ]
    )
    direct = categories.alias("direct")
    inherited = categories.alias("inherited")
    category_id = sa.case((products.c.category_id.is_not(None), direct.c.id), else_=inherited.c.id)
    activity_id = sa.case(
        (products.c.category_id.is_not(None), direct.c.activity_id), else_=inherited.c.activity_id
    )
    item_query = (
        sa.select(items, category_id.label("category_id"), activity_id.label("activity_id"))
        .join(products, products.c.id == items.c.product_id)
        .outerjoin(direct, direct.c.id == products.c.category_id)
        .outerjoin(series, series.c.id == products.c.series_id)
        .outerjoin(inherited, inherited.c.id == series.c.category_id)
        .order_by(items.c.created_at, items.c.id)
    )
    candidates = (
        connection.execute(
            sa.select(orders)
            .where(
                orders.c.activity_id.is_(None),
                orders.c.is_paid.is_(False),
                orders.c.is_class_collected.is_(False),
                sa.func.lower(sa.cast(orders.c.status, sa.String)).in_(["pending", "confirmed"]),
            )
            .with_for_update()
        )
        .mappings()
        .all()
    )
    split_count = 0
    for original in candidates:
        source_id = original["id"]
        receivable = (
            connection.execute(
                sa.select(receivables).where(
                    receivables.c.source_type == "shop_order", receivables.c.source_id == source_id
                )
            )
            .mappings()
            .first()
        )
        if receivable and (receivable["paid_amount"] or receivable["refunded_amount"]):
            continue
        if connection.scalar(sa.select(seats.c.id).where(seats.c.order_id == source_id).limit(1)):
            continue
        if connection.scalar(sa.select(links.c.id).where(links.c.target_id == source_id).limit(1)):
            continue
        groups = defaultdict(list)
        for item in connection.execute(item_query.where(items.c.order_id == source_id)).mappings():
            activity = item["activity_id"]
            groups[(activity, None if activity else item["category_id"])].append(item)
        if not groups:
            continue
        scopes = list(groups)
        gross = [
            sum(item["quantity"] * item["unit_price"] for item in groups[key]) for key in scopes
        ]
        if sum(gross) - original["discount_amount"] != original["total_price"]:
            continue  # Preserve anomalous accounting for an explicit review.
        if len(groups) == 1:
            if scopes[0][0]:
                connection.execute(
                    orders.update().where(orders.c.id == source_id).values(activity_id=scopes[0][0])
                )
            continue
        discount_parts = _allocate(original["discount_amount"], gross)
        applied = (
            connection.execute(sa.select(discounts).where(discounts.c.order_id == source_id))
            .mappings()
            .all()
        )
        if (
            applied
            and sum(row["discount_amount"] for row in applied) != original["discount_amount"]
        ):
            continue
        allocations = []
        remaining = discount_parts.copy()
        for applied_row in applied:
            parts = _allocate(applied_row["discount_amount"], remaining)
            remaining = [left - part for left, part in zip(remaining, parts, strict=True)]
            allocations.append(parts)
        for index, key in enumerate(scopes):
            target_id = source_id if index == 0 else uuid.uuid4()
            values = dict(original)
            values.update(
                id=target_id,
                activity_id=key[0],
                category_id=key[1],
                subtotal_price=gross[index],
                discount_amount=discount_parts[index],
                total_price=gross[index] - discount_parts[index],
            )
            if index == 0:
                connection.execute(orders.update().where(orders.c.id == source_id).values(**values))
            else:
                serial = f"{original['serial_number'][:22]}-S{index + 1}"
                suffix = index + 1
                while connection.scalar(
                    sa.select(orders.c.id).where(orders.c.serial_number == serial)
                ):
                    suffix += 1
                    serial = f"{original['serial_number'][:22]}-S{suffix}"
                values["serial_number"] = serial
                values["notes"] = (
                    f"{original['notes'] or ''}\n由 {original['serial_number']} 依活動拆分".strip()
                )
                connection.execute(orders.insert().values(**values))
                connection.execute(
                    items.update()
                    .where(items.c.id.in_([item["id"] for item in groups[key]]))
                    .values(order_id=target_id)
                )
            for applied_row, parts in zip(applied, allocations, strict=True):
                if index == 0:
                    connection.execute(
                        discounts.update()
                        .where(
                            discounts.c.order_id == source_id,
                            discounts.c.promotion_id == applied_row["promotion_id"],
                        )
                        .values(discount_amount=parts[index])
                    )
                else:
                    connection.execute(
                        discounts.insert().values(
                            order_id=target_id,
                            promotion_id=applied_row["promotion_id"],
                            discount_amount=parts[index],
                        )
                    )
                    connection.execute(
                        promotions.update()
                        .where(promotions.c.id == applied_row["promotion_id"])
                        .values(used_count=promotions.c.used_count + 1)
                    )
            if receivable:
                receivable_values = dict(receivable)
                receivable_values.update(
                    source_id=target_id,
                    activity_id=key[0],
                    amount=values["total_price"],
                    title=f"商品訂單 {values['serial_number']}",
                )
                if index == 0:
                    connection.execute(
                        receivables.update()
                        .where(receivables.c.id == receivable["id"])
                        .values(**receivable_values)
                    )
                else:
                    receivable_values["id"] = uuid.uuid4()
                    connection.execute(receivables.insert().values(**receivable_values))
        split_count += 1
    return split_count


def upgrade() -> None:
    from sqlalchemy.dialects import postgresql

    op.add_column("orders", sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_orders_category_id_product_categories",
        "orders",
        "product_categories",
        ["category_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_orders_category_id", "orders", ["category_id"])
    op.execute(
        sa.text("""
        WITH item_scopes AS (
            SELECT oi.order_id,
                CASE WHEN product.category_id IS NOT NULL THEN direct.id ELSE inherited.id END AS category_id,
                CASE WHEN product.category_id IS NOT NULL THEN direct.activity_id ELSE inherited.activity_id END AS activity_id
            FROM order_items oi
            JOIN products product ON product.id = oi.product_id
            LEFT JOIN product_categories direct ON direct.id = product.category_id
            LEFT JOIN product_series series ON series.id = product.series_id
            LEFT JOIN product_categories inherited ON inherited.id = series.category_id
        ), single_scopes AS (
            SELECT order_id, min(category_id::text)::uuid AS category_id
            FROM item_scopes GROUP BY order_id
            HAVING count(DISTINCT coalesce(category_id::text, '__none__')) = 1
                AND count(activity_id) = 0
        )
        UPDATE orders SET category_id = single_scopes.category_id
        FROM single_scopes
        WHERE orders.id = single_scopes.order_id AND orders.activity_id IS NULL
    """)
    )
    _split_uncollected_orders(op.get_bind())


def downgrade() -> None:
    # Recombining orders after users have edited/paid them would corrupt their history.
    # Split orders retain their identities and snapshots when removing the scope column.
    op.drop_index("ix_orders_category_id", "orders")
    op.drop_constraint("fk_orders_category_id_product_categories", "orders", type_="foreignkey")
    op.drop_column("orders", "category_id")
