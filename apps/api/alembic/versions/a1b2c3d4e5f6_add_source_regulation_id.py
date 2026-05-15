"""add source_regulation_id to regulations

Revision ID: 20260515140000
Revises: 20260514143000
Create Date: 2026-05-15 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "20260515140000"
down_revision: str | Sequence[str] | None = "20260514143000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """新增 regulations.source_regulation_id 欄位（記錄 fork 來源以追蹤血緣鏈）。"""
    op.add_column(
        "regulations",
        sa.Column("source_regulation_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_regulations_source_regulation_id",
        "regulations",
        "regulations",
        ["source_regulation_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_regulations_source_regulation_id",
        "regulations",
        ["source_regulation_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_regulations_source_regulation_id", table_name="regulations")
    op.drop_constraint(
        "fk_regulations_source_regulation_id", "regulations", type_="foreignkey"
    )
    op.drop_column("regulations", "source_regulation_id")
