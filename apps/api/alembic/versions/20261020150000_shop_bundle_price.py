"""新增商品套組固定價格優惠。"""

from alembic import op

revision = "20261020150000"
down_revision = "20261019100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE shopdiscounttype ADD VALUE IF NOT EXISTS 'BUNDLE_PRICE'")


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM shop_promotions WHERE discount_type::text = 'BUNDLE_PRICE'
            ) THEN
                RAISE EXCEPTION 'Cannot downgrade while bundle-price promotions exist';
            END IF;
            CREATE TYPE shopdiscounttype_old AS ENUM ('PERCENTAGE', 'FIXED', 'PRICE_OVERRIDE');
            ALTER TABLE shop_promotions
                ALTER COLUMN discount_type TYPE shopdiscounttype_old
                USING discount_type::text::shopdiscounttype_old;
            DROP TYPE shopdiscounttype;
            ALTER TYPE shopdiscounttype_old RENAME TO shopdiscounttype;
        END
        $$;
        """
    )
