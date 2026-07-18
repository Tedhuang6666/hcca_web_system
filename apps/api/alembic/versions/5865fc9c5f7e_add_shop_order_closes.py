"""add_shop_order_closes

Revision ID: 5865fc9c5f7e
Revises: 5694b02b3aeb
Create Date: 2026-07-04 15:49:00.198251

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "5865fc9c5f7e"
down_revision = "5694b02b3aeb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "shop_order_closes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("category_id", sa.UUID(), nullable=False),
        sa.Column("class_id", sa.UUID(), nullable=True),
        sa.Column("closed_by_id", sa.UUID(), nullable=False),
        sa.Column("reopened_by_id", sa.UUID(), nullable=True),
        sa.Column("reopened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["category_id"], ["product_categories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["class_id"], ["school_classes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["closed_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["reopened_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_shop_order_closes_category_id"), "shop_order_closes", ["category_id"], unique=False
    )
    op.create_index(
        op.f("ix_shop_order_closes_class_id"), "shop_order_closes", ["class_id"], unique=False
    )
    op.create_index(
        op.f("ix_shop_order_closes_is_active"), "shop_order_closes", ["is_active"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_shop_order_closes_is_active"), table_name="shop_order_closes")
    op.drop_index(op.f("ix_shop_order_closes_class_id"), table_name="shop_order_closes")
    op.drop_index(op.f("ix_shop_order_closes_category_id"), table_name="shop_order_closes")
    op.drop_table("shop_order_closes")
