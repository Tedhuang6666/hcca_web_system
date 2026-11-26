"""Remove the shared Activity domain and its module associations.

Revision ID: 20261126030000
Revises: 20261126020000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261126030000"
down_revision: str | None = "20261126020000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Preserve order category scope where every item resolves to the same category.
    op.execute(
        """
        WITH item_categories AS (
            SELECT
                order_item.order_id,
                min(coalesce(product.category_id, series.category_id)::text)::uuid AS category_id
            FROM order_items AS order_item
            JOIN products AS product ON product.id = order_item.product_id
            LEFT JOIN product_series AS series ON series.id = product.series_id
            GROUP BY order_item.order_id
            HAVING count(DISTINCT coalesce(product.category_id, series.category_id)) = 1
        )
        UPDATE orders AS shop_order
        SET category_id = item_categories.category_id
        FROM item_categories
        WHERE shop_order.id = item_categories.order_id
          AND shop_order.category_id IS NULL
        """
    )

    # Convert Activity-bound promotions into category-scoped promotions. Promotions
    # whose Activity had no categories are disabled so they cannot become global.
    op.execute(
        """
        UPDATE shop_promotions AS promotion
        SET target_category_ids = COALESCE(
                (
                    SELECT jsonb_agg(to_jsonb(category.id::text) ORDER BY category.id)
                    FROM product_categories AS category
                    WHERE category.activity_id = promotion.activity_id
                ),
                '[]'::jsonb
            ),
            is_active = promotion.is_active AND EXISTS (
                SELECT 1
                FROM product_categories AS category
                WHERE category.activity_id = promotion.activity_id
            )
        WHERE promotion.activity_id IS NOT NULL
          AND promotion.target_category_ids IS NULL
        """
    )
    op.execute(
        """
        UPDATE shop_promotions
        SET target_category_ids = '[]'::jsonb
        WHERE activity_id IS NULL AND target_category_ids IS NULL
        """
    )

    # A class payment is now class-wide. Preserve paid status only when every
    # previous Activity scope for that class was paid.
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                class_id,
                row_number() OVER (
                    PARTITION BY class_id
                    ORDER BY is_paid DESC, confirmed_at DESC NULLS LAST, created_at DESC, id
                ) AS position
            FROM shop_class_payments
        ),
        combined AS (
            SELECT
                class_id,
                bool_and(is_paid) AS is_paid,
                (array_agg(
                    confirmed_at ORDER BY is_paid DESC, confirmed_at DESC NULLS LAST,
                    created_at DESC, id
                ))[1] AS confirmed_at,
                (array_agg(
                    confirmed_by_id ORDER BY is_paid DESC, confirmed_at DESC NULLS LAST,
                    created_at DESC, id
                ))[1] AS confirmed_by_id
            FROM shop_class_payments
            GROUP BY class_id
        )
        UPDATE shop_class_payments AS payment
        SET is_paid = combined.is_paid,
            confirmed_at = CASE WHEN combined.is_paid THEN combined.confirmed_at ELSE NULL END,
            confirmed_by_id = CASE
                WHEN combined.is_paid THEN combined.confirmed_by_id ELSE NULL
            END
        FROM ranked, combined
        WHERE payment.id = ranked.id
          AND ranked.position = 1
          AND combined.class_id = payment.class_id
        """
    )
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                row_number() OVER (
                    PARTITION BY class_id
                    ORDER BY is_paid DESC, confirmed_at DESC NULLS LAST, created_at DESC, id
                ) AS position
            FROM shop_class_payments
        )
        DELETE FROM shop_class_payments AS payment
        USING ranked
        WHERE payment.id = ranked.id AND ranked.position > 1
        """
    )

    # Historical activity fees remain receivables, detached from the deleted
    # source identity so the source uniqueness key cannot collide with manual rows.
    op.execute(
        """
        UPDATE receivables
        SET source_type = 'manual', source_id = NULL
        WHERE source_type = 'activity_fee'
        """
    )
    op.execute("UPDATE matters SET matter_type = 'administration' WHERE matter_type = 'activity'")

    # Activity workflows and links to Activity targets no longer have a source.
    op.execute("DELETE FROM workflow_links WHERE target_type = 'activity'")
    op.execute("DELETE FROM workflow_instances WHERE source_type = 'activity'")
    op.execute(
        "DELETE FROM entity_relations WHERE source_type = 'activity' OR target_type = 'activity'"
    )
    op.execute("DELETE FROM decisions WHERE source_type = 'activity'")
    op.execute("DELETE FROM timeline_events WHERE event_type LIKE 'activity.%'")
    op.execute("DELETE FROM governance_discord_event_routes WHERE event_type LIKE 'activity.%'")
    op.execute("DELETE FROM outbox_events WHERE event_type LIKE 'activity.%'")
    op.execute(
        "DELETE FROM automation_rules WHERE trigger_type IN ('activity.created', 'activity.completed')"
    )
    op.execute(
        """
        UPDATE automation_rules AS rule
        SET actions = COALESCE(
            (
                SELECT jsonb_agg(action)
                FROM jsonb_array_elements(rule.actions) AS elements(action)
                WHERE COALESCE(action ->> 'source_type', '') <> 'activity'
                  AND COALESCE(action ->> 'target_type', '') <> 'activity'
            ),
            '[]'::jsonb
        )
        WHERE rule.actions @> '[{"source_type":"activity"}]'::jsonb
           OR rule.actions @> '[{"target_type":"activity"}]'::jsonb
        """
    )

    op.drop_index("ix_announcements_activity_published", table_name="announcements")
    op.drop_index("ix_publication_campaigns_activity_status", table_name="publication_campaigns")
    op.drop_index("ix_receivables_activity_status", table_name="receivables")
    op.drop_index("ix_workflow_instances_activity", table_name="workflow_instances")
    op.drop_index("uq_shop_class_payments_scope", table_name="shop_class_payments")

    for table_name in (
        "announcements",
        "documents",
        "publication_campaigns",
        "receivables",
        "product_categories",
        "orders",
        "shop_delegation_links",
        "shop_promotions",
        "shop_class_payments",
        "surveys",
        "workflow_instances",
    ):
        op.drop_column(table_name, "activity_id")

    op.create_index(
        "uq_shop_class_payments_class", "shop_class_payments", ["class_id"], unique=True
    )
    op.drop_table("activity_conveners")
    op.drop_table("activities")


def downgrade() -> None:
    raise RuntimeError(
        "Activity data and cross-module associations were removed; restore from a pre-migration backup."
    )
