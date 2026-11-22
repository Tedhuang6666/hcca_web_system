"""為公開連結新增啟用與停用時間。"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261001100000"
down_revision = "20260930100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "public_links",
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "public_links",
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("public_links", "ends_at")
    op.drop_column("public_links", "starts_at")
