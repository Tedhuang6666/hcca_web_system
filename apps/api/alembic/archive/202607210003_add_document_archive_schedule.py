"""新增公文預約歸檔時間與索引"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607210003"
down_revision: str | Sequence[str] | None = "202607210002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("archive_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_documents_status_archive_at",
        "documents",
        ["status", "archive_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_documents_status_archive_at", table_name="documents")
    op.drop_column("documents", "archive_at")
