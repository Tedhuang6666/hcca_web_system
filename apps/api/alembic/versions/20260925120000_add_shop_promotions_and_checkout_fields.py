"""新增校商公開結帳優惠與付款欄位"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260925120000"
down_revision: str | Sequence[str] | None = "20260925100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("subtotal_price", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "orders",
        sa.Column("discount_amount", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("orders", sa.Column("promotion_code", sa.String(length=80), nullable=True))
    op.add_column(
        "orders",
        sa.Column(
            "payment_method",
            sa.String(length=30),
            server_default="cash_on_pickup",
            nullable=False,
        ),
    )

    op.create_table(
        "shop_promotions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("code", sa.String(length=80), nullable=True),
        sa.Column("target_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "discount_type",
            sa.Enum("PERCENTAGE", "FIXED", name="shopdiscounttype"),
            nullable=False,
        ),
        sa.Column("discount_value", sa.Integer(), nullable=False),
        sa.Column("min_order_price", sa.Integer(), server_default="0", nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("used_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
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
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_shop_promotions_code", "shop_promotions", ["code"], unique=True)
    op.create_index(
        "ix_shop_promotions_target_user_id", "shop_promotions", ["target_user_id"], unique=False
    )
    op.create_index("ix_shop_promotions_is_active", "shop_promotions", ["is_active"], unique=False)
    op.create_index(
        "ix_shop_promotions_created_by", "shop_promotions", ["created_by"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_shop_promotions_created_by", table_name="shop_promotions")
    op.drop_index("ix_shop_promotions_is_active", table_name="shop_promotions")
    op.drop_index("ix_shop_promotions_target_user_id", table_name="shop_promotions")
    op.drop_index("ix_shop_promotions_code", table_name="shop_promotions")
    op.drop_table("shop_promotions")
    sa.Enum(name="shopdiscounttype").drop(op.get_bind(), checkfirst=True)
    op.drop_column("orders", "payment_method")
    op.drop_column("orders", "promotion_code")
    op.drop_column("orders", "discount_amount")
    op.drop_column("orders", "subtotal_price")
