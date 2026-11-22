"""特約標籤加入可設定圖示。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0a7c8d9e1f20"
down_revision: str | Sequence[str] | None = "ffff8afe1b1d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("partner_tags", sa.Column("icon_key", sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column("partner_tags", "icon_key")
