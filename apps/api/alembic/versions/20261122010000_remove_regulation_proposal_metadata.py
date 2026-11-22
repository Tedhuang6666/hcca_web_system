"""移除法規提案資料，另存檔案匯入標記。

Revision ID: 20261122010000
Revises: 20261117040000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261122010000"
down_revision: str | None = "20261117040000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "regulations",
        sa.Column(
            "is_imported_from_file",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.execute(
        sa.text(
            """
            UPDATE regulations
            SET is_imported_from_file = true
            WHERE substr(proposal_metadata, 1, 15) = '__file_import__'
            """
        )
    )
    op.drop_column("regulation_revisions", "proposal_metadata_snapshot")
    op.drop_column("regulations", "proposal_metadata")


def downgrade() -> None:
    # 提案內容已由升版刪除；降版只恢復欄位結構與檔案匯入標記。
    op.add_column("regulations", sa.Column("proposal_metadata", sa.Text(), nullable=True))
    op.add_column(
        "regulation_revisions",
        sa.Column("proposal_metadata_snapshot", sa.Text(), nullable=True),
    )
    op.execute(
        sa.text(
            """
            UPDATE regulations
            SET proposal_metadata = '__file_import__'
            WHERE is_imported_from_file IS TRUE
            """
        )
    )
    op.drop_column("regulations", "is_imported_from_file")
