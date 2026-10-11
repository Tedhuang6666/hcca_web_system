"""Add student delegation links and immutable item attribution.

Revision ID: 20261011100000
Revises: 20261010100000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261011100000"
down_revision = "20261010100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shop_delegation_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "category_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("product_categories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "activity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("activities.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "bound_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_shop_delegation_links_user_id", "shop_delegation_links", ["user_id"])
    op.add_column(
        "order_items", sa.Column("ordered_by_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column("order_items", sa.Column("ordered_by_name", sa.String(200), nullable=True))
    op.add_column(
        "order_items", sa.Column("delegation_link_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column("order_items", sa.Column("delegation_name", sa.String(80), nullable=True))
    op.create_foreign_key(
        "fk_order_items_ordered_by",
        "order_items",
        "users",
        ["ordered_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_order_items_delegation_link",
        "order_items",
        "shop_delegation_links",
        ["delegation_link_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_order_items_delegation_link_id", "order_items", ["delegation_link_id"])
    # 舊訂單只沿用可確認的本人／班級幹部資訊，不推測家人身分。
    op.execute("""
        UPDATE order_items AS item
        SET ordered_by_id = actor.id, ordered_by_name = actor.display_name
        FROM orders AS ord JOIN users AS actor
          ON actor.id = COALESCE(ord.assisted_by_id, ord.user_id)
        WHERE item.order_id = ord.id
    """)


def downgrade() -> None:
    op.drop_index("ix_order_items_delegation_link_id", table_name="order_items")
    op.drop_constraint("fk_order_items_delegation_link", "order_items", type_="foreignkey")
    op.drop_constraint("fk_order_items_ordered_by", "order_items", type_="foreignkey")
    for column in ("delegation_name", "delegation_link_id", "ordered_by_name", "ordered_by_id"):
        op.drop_column("order_items", column)
    op.drop_table("shop_delegation_links")
