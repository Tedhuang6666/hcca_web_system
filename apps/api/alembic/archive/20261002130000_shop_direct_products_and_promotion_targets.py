"""Allow products without a series and promotions with multiple targets."""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op

revision = "20261002130000"
down_revision = "20261002120000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("category_id", sa.Uuid(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_products_category_id_product_categories",
        "products",
        "product_categories",
        ["category_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.execute(
        sa.text(
            """
            UPDATE products AS product
            SET category_id = series.category_id
            FROM product_series AS series
            WHERE product.series_id = series.id
              AND product.category_id IS NULL
            """
        )
    )
    op.alter_column("products", "series_id", existing_type=sa.Uuid(as_uuid=True), nullable=True)
    op.create_check_constraint(
        "ck_products_category_or_series",
        "products",
        "category_id IS NOT NULL OR series_id IS NOT NULL",
    )
    op.create_index(
        "ix_products_category_status_created",
        "products",
        ["category_id", "status", sa.text("created_at DESC")],
    )

    op.create_table(
        "shop_promotion_users",
        sa.Column("promotion_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["promotion_id"], ["shop_promotions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("promotion_id", "user_id"),
    )
    op.create_index("ix_shop_promotion_users_user_id", "shop_promotion_users", ["user_id"])
    op.execute(
        sa.text(
            """
            INSERT INTO shop_promotion_users (promotion_id, user_id)
            SELECT id, target_user_id
            FROM shop_promotions
            WHERE target_user_id IS NOT NULL
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    multiple_targets = bind.execute(
        sa.text(
            """
            SELECT promotion_id
            FROM shop_promotion_users
            GROUP BY promotion_id
            HAVING COUNT(*) > 1
            LIMIT 1
            """
        )
    ).first()
    if multiple_targets is not None:
        raise RuntimeError("Cannot downgrade: some promotions have multiple target users")

    direct_categories = (
        bind.execute(
            sa.text(
                """
            SELECT DISTINCT category_id
            FROM products
            WHERE series_id IS NULL AND category_id IS NOT NULL
            """
            )
        )
        .scalars()
        .all()
    )
    for category_id in direct_categories:
        series_id = uuid.uuid4()
        bind.execute(
            sa.text(
                """
                INSERT INTO product_series (id, category_id, name, sort_order, is_active)
                VALUES (:id, :category_id, '單一商品', 0, true)
                """
            ),
            {"id": series_id, "category_id": category_id},
        )
        bind.execute(
            sa.text(
                """
                UPDATE products
                SET series_id = :series_id
                WHERE category_id = :category_id AND series_id IS NULL
                """
            ),
            {"series_id": series_id, "category_id": category_id},
        )

    bind.execute(
        sa.text(
            """
            UPDATE shop_promotions AS promotion
            SET target_user_id = target.user_id
            FROM shop_promotion_users AS target
            WHERE promotion.id = target.promotion_id
              AND promotion.target_user_id IS NULL
            """
        )
    )
    op.drop_index("ix_shop_promotion_users_user_id", table_name="shop_promotion_users")
    op.drop_table("shop_promotion_users")
    op.drop_index("ix_products_category_status_created", table_name="products")
    op.drop_constraint("ck_products_category_or_series", "products", type_="check")
    op.alter_column("products", "series_id", existing_type=sa.Uuid(as_uuid=True), nullable=False)
    op.drop_constraint("fk_products_category_id_product_categories", "products", type_="foreignkey")
    op.drop_column("products", "category_id")
