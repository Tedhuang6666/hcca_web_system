"""移除校商優惠碼重複的唯一約束"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260926100000"
down_revision: str | Sequence[str] | None = "20260925120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("shop_promotions_code_key", "shop_promotions", type_="unique")


def downgrade() -> None:
    op.create_unique_constraint("shop_promotions_code_key", "shop_promotions", ["code"])
