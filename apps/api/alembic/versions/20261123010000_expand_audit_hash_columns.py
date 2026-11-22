"""擴充稽核鏈欄位以儲存版本化 HMAC。

Revision ID: 20261123010000
Revises: 20261122010000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261123010000"
down_revision: str | None = "20261122010000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "audit_logs",
        "prev_hash",
        existing_type=sa.String(length=64),
        type_=sa.String(length=128),
        existing_nullable=True,
    )
    op.alter_column(
        "audit_logs",
        "self_hash",
        existing_type=sa.String(length=64),
        type_=sa.String(length=128),
        existing_nullable=True,
    )


def downgrade() -> None:
    has_long_hash = op.get_bind().execute(
        sa.text(
            """
            SELECT 1
            FROM audit_logs
            WHERE length(prev_hash) > 64 OR length(self_hash) > 64
            LIMIT 1
            """
        )
    ).first()
    if has_long_hash:
        raise RuntimeError("無法降版：audit_logs 已含超過 64 字元的版本化 hash")

    op.alter_column(
        "audit_logs",
        "prev_hash",
        existing_type=sa.String(length=128),
        type_=sa.String(length=64),
        existing_nullable=True,
    )
    op.alter_column(
        "audit_logs",
        "self_hash",
        existing_type=sa.String(length=128),
        type_=sa.String(length=64),
        existing_nullable=True,
    )
