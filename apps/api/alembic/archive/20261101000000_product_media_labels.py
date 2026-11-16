"""新增商品圖片標註。

Revision ID: 20261101000000
Revises: 20261029170000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261101000000"
down_revision: str | None = "20261029170000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("product_media", sa.Column("label", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("product_media", "label")
