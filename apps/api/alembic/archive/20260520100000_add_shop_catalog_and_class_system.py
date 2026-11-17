"""add shop catalog hierarchy, variants, cart and class system

Revision ID: 20260520100000
Revises: 20260519113000
Create Date: 2026-05-20 10:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260520100000"
down_revision: str | Sequence[str] | None = "20260519113000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOW = sa.text("now()")


def upgrade() -> None:
    # ── 班級系統 ───────────────────────────────────────────────────────────
    op.create_table(
        "school_classes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("academic_year", sa.Integer(), nullable=False),
        sa.Column("class_code", sa.String(length=20), nullable=False),
        sa.Column("grade", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("label", sa.String(length=100), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("academic_year", "class_code", name="uq_class_year_code"),
    )
    op.create_index("ix_school_classes_academic_year", "school_classes", ["academic_year"])
    op.create_index("ix_school_classes_grade", "school_classes", ["grade"])
    op.create_index("ix_school_classes_is_active", "school_classes", ["is_active"])

    op.create_table(
        "class_student_ranges",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("student_id_start", sa.String(length=20), nullable=False),
        sa.Column("student_id_end", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["class_id"], ["school_classes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_class_student_ranges_class_id", "class_student_ranges", ["class_id"])

    op.create_table(
        "class_cadres",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["class_id"], ["school_classes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("class_id", "user_id", name="uq_class_cadre"),
    )
    op.create_index("ix_class_cadres_class_id", "class_cadres", ["class_id"])
    op.create_index("ix_class_cadres_user_id", "class_cadres", ["user_id"])

    # ── 商品分類階層：主題 → 系列 ─────────────────────────────────────────
    op.create_table(
        "product_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_product_categories_org_id", "product_categories", ["org_id"])
    op.create_index("ix_product_categories_is_active", "product_categories", ["is_active"])

    op.create_table(
        "product_series",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["category_id"], ["product_categories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_product_series_category_id", "product_series", ["category_id"])
    op.create_index("ix_product_series_is_active", "product_series", ["is_active"])

    # ── 商品變體 ───────────────────────────────────────────────────────────
    op.create_table(
        "product_variant_groups",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_product_variant_groups_product_id", "product_variant_groups", ["product_id"]
    )

    op.create_table(
        "product_variant_options",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("value", sa.String(length=100), nullable=False),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("price_delta", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(
            ["group_id"], ["product_variant_groups.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_product_variant_options_group_id", "product_variant_options", ["group_id"]
    )

    # ── 購物車 ─────────────────────────────────────────────────────────────
    op.create_table(
        "carts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_carts_user"),
    )

    op.create_table(
        "cart_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cart_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "selected_options",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["cart_id"], ["carts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cart_items_cart_id", "cart_items", ["cart_id"])
    op.create_index("ix_cart_items_product_id", "cart_items", ["product_id"])

    # ── products：新增 series_id / image_url ──────────────────────────────
    op.add_column("products", sa.Column("image_url", sa.Text(), nullable=True))
    op.add_column(
        "products", sa.Column("series_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_products_series_id",
        "products",
        "product_series",
        ["series_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_products_series_id", "products", ["series_id"])

    # 回填：對每個 org 建立預設「未分類」主題與系列，並設定既有商品的 series_id
    op.execute(
        """
        INSERT INTO product_categories
            (id, org_id, name, sort_order, is_active, created_by, created_at, updated_at)
        SELECT gen_random_uuid(), d.org_id, '未分類', 0, true,
               (SELECT created_by FROM products WHERE org_id = d.org_id LIMIT 1),
               now(), now()
        FROM (SELECT DISTINCT org_id FROM products) AS d
        """
    )
    op.execute(
        """
        INSERT INTO product_series
            (id, category_id, name, sort_order, is_active, created_at, updated_at)
        SELECT gen_random_uuid(), c.id, '未分類', 0, true, now(), now()
        FROM product_categories c
        WHERE c.name = '未分類'
        """
    )
    op.execute(
        """
        UPDATE products p
        SET series_id = s.id
        FROM product_series s
        JOIN product_categories c ON s.category_id = c.id
        WHERE c.org_id = p.org_id AND p.series_id IS NULL
        """
    )
    op.alter_column("products", "series_id", nullable=False)

    # ── orders：新增班級結單 / 繳費欄位 ───────────────────────────────────
    op.add_column(
        "orders", sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column(
        "orders",
        sa.Column("is_paid", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "orders", sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "orders", sa.Column("paid_by_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_orders_class_id",
        "orders",
        "school_classes",
        ["class_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_orders_paid_by_id",
        "orders",
        "users",
        ["paid_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_orders_class_id", "orders", ["class_id"])

    # ── order_items：新增變體快照，移除單一商品唯一限制 ──────────────────
    op.add_column(
        "order_items",
        sa.Column(
            "selected_options",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.drop_constraint("uq_order_product", "order_items", type_="unique")


def downgrade() -> None:
    op.create_unique_constraint(
        "uq_order_product", "order_items", ["order_id", "product_id"]
    )
    op.drop_column("order_items", "selected_options")

    op.drop_index("ix_orders_class_id", table_name="orders")
    op.drop_constraint("fk_orders_paid_by_id", "orders", type_="foreignkey")
    op.drop_constraint("fk_orders_class_id", "orders", type_="foreignkey")
    op.drop_column("orders", "paid_by_id")
    op.drop_column("orders", "paid_at")
    op.drop_column("orders", "is_paid")
    op.drop_column("orders", "class_id")

    op.drop_index("ix_products_series_id", table_name="products")
    op.drop_constraint("fk_products_series_id", "products", type_="foreignkey")
    op.drop_column("products", "series_id")
    op.drop_column("products", "image_url")

    op.drop_index("ix_cart_items_product_id", table_name="cart_items")
    op.drop_index("ix_cart_items_cart_id", table_name="cart_items")
    op.drop_table("cart_items")
    op.drop_table("carts")

    op.drop_index(
        "ix_product_variant_options_group_id", table_name="product_variant_options"
    )
    op.drop_table("product_variant_options")
    op.drop_index(
        "ix_product_variant_groups_product_id", table_name="product_variant_groups"
    )
    op.drop_table("product_variant_groups")

    op.drop_index("ix_product_series_is_active", table_name="product_series")
    op.drop_index("ix_product_series_category_id", table_name="product_series")
    op.drop_table("product_series")
    op.drop_index("ix_product_categories_is_active", table_name="product_categories")
    op.drop_index("ix_product_categories_org_id", table_name="product_categories")
    op.drop_table("product_categories")

    op.drop_index("ix_class_cadres_user_id", table_name="class_cadres")
    op.drop_index("ix_class_cadres_class_id", table_name="class_cadres")
    op.drop_table("class_cadres")
    op.drop_index("ix_class_student_ranges_class_id", table_name="class_student_ranges")
    op.drop_table("class_student_ranges")
    op.drop_index("ix_school_classes_is_active", table_name="school_classes")
    op.drop_index("ix_school_classes_grade", table_name="school_classes")
    op.drop_index("ix_school_classes_academic_year", table_name="school_classes")
    op.drop_table("school_classes")
