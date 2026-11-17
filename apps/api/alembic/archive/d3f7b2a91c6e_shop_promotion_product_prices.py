"""Add per-product promotional prices."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d3f7b2a91c6e"
down_revision: str | Sequence[str] | None = "504e3ea112ea"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE shopdiscounttype ADD VALUE IF NOT EXISTS 'PRICE_OVERRIDE'")
    op.create_table(
        "shop_promotion_product_prices",
        sa.Column("promotion_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("unit_price", sa.Integer(), nullable=False),
        sa.CheckConstraint("unit_price >= 0", name="ck_shop_promotion_product_prices_nonnegative"),
        sa.ForeignKeyConstraint(["promotion_id"], ["shop_promotions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("promotion_id", "product_id"),
    )
    op.create_index(
        "ix_shop_promotion_product_prices_product_id",
        "shop_promotion_product_prices",
        ["product_id"],
        unique=False,
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM shop_promotions
                WHERE discount_type::text = 'PRICE_OVERRIDE'
            ) THEN
                RAISE EXCEPTION
                    'Cannot downgrade while price-override promotions exist';
            END IF;

            CREATE TYPE shopdiscounttype_old AS ENUM ('PERCENTAGE', 'FIXED');
            ALTER TABLE shop_promotions
                ALTER COLUMN discount_type TYPE shopdiscounttype_old
                USING discount_type::text::shopdiscounttype_old;
            DROP TYPE shopdiscounttype;
            ALTER TYPE shopdiscounttype_old RENAME TO shopdiscounttype;
        END
        $$;
        """
    )
    op.drop_table("shop_promotion_product_prices")
