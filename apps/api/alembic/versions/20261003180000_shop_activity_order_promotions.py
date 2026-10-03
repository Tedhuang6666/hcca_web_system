"""Scope shop orders and promotions by activity and preserve stacked discounts.

Revision ID: 20261003180000
Revises: 20261003170000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261003180000"
down_revision: str | Sequence[str] | None = "20261003170000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_orders_activity_id_activities",
        "orders",
        "activities",
        ["activity_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_orders_activity_id", "orders", ["activity_id"])

    op.add_column(
        "shop_promotions",
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_shop_promotions_activity_id_activities",
        "shop_promotions",
        "activities",
        ["activity_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_shop_promotions_activity_id", "shop_promotions", ["activity_id"])

    op.create_table(
        "shop_order_promotions",
        sa.Column("order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("promotion_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("discount_amount", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["promotion_id"], ["shop_promotions.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("order_id", "promotion_id"),
    )
    op.create_index(
        "ix_shop_order_promotions_promotion_id",
        "shop_order_promotions",
        ["promotion_id"],
    )

    op.execute(
        sa.text(
            """
            WITH item_activities AS (
                SELECT
                    oi.order_id,
                    COALESCE(direct_category.activity_id, series_category.activity_id) AS activity_id
                FROM order_items AS oi
                JOIN products AS product ON product.id = oi.product_id
                LEFT JOIN product_categories AS direct_category
                    ON direct_category.id = product.category_id
                LEFT JOIN product_series AS series ON series.id = product.series_id
                LEFT JOIN product_categories AS series_category
                    ON series_category.id = series.category_id
            ), grouped_activities AS (
                SELECT
                    order_id,
                    COUNT(DISTINCT COALESCE(activity_id::text, '__unscoped__')) AS scope_count,
                    MIN(activity_id::text)::uuid AS activity_id
                FROM item_activities
                GROUP BY order_id
            )
            UPDATE orders AS target
            SET activity_id = grouped.activity_id
            FROM grouped_activities AS grouped
            WHERE target.id = grouped.order_id AND grouped.scope_count = 1
            """
        )
    )
    op.execute(
        sa.text(
            """
            WITH target_activities AS (
                SELECT
                    target.promotion_id,
                    COUNT(DISTINCT COALESCE(scope.activity_id::text, '__unscoped__')) AS scope_count,
                    MIN(scope.activity_id::text)::uuid AS activity_id
                FROM shop_promotion_products AS target
                JOIN products AS product ON product.id = target.product_id
                LEFT JOIN product_categories AS direct_category
                    ON direct_category.id = product.category_id
                LEFT JOIN product_series AS series ON series.id = product.series_id
                LEFT JOIN product_categories AS series_category
                    ON series_category.id = series.category_id
                CROSS JOIN LATERAL (
                    SELECT COALESCE(direct_category.activity_id, series_category.activity_id) AS activity_id
                ) AS scope
                GROUP BY target.promotion_id
            )
            UPDATE shop_promotions AS promotion
            SET activity_id = target.activity_id
            FROM target_activities AS target
            WHERE promotion.id = target.promotion_id
                AND promotion.activity_id IS NULL
                AND target.scope_count = 1
                AND target.activity_id IS NOT NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO shop_order_promotions (order_id, promotion_id, discount_amount)
            SELECT id, promotion_id, discount_amount
            FROM orders
            WHERE promotion_id IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_shop_order_promotions_promotion_id", table_name="shop_order_promotions")
    op.drop_table("shop_order_promotions")

    op.drop_index("ix_shop_promotions_activity_id", table_name="shop_promotions")
    op.drop_constraint(
        "fk_shop_promotions_activity_id_activities", "shop_promotions", type_="foreignkey"
    )
    op.drop_column("shop_promotions", "activity_id")

    op.drop_index("ix_orders_activity_id", table_name="orders")
    op.drop_constraint("fk_orders_activity_id_activities", "orders", type_="foreignkey")
    op.drop_column("orders", "activity_id")
