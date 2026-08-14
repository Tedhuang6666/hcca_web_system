"""補充法規沿革日期精度與公布公文關聯。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260814160000"
down_revision: str | Sequence[str] | None = "20260814150000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column(
        "regulation_revisions",
        sa.Column("amended_at_precision", sa.String(length=10), server_default="date", nullable=False),
    )
    op.add_column("regulation_revisions", sa.Column("amended_year", sa.Integer(), nullable=True))
    op.add_column(
        "documents",
        sa.Column("regulation_revision_id", UUID, nullable=True),
    )
    op.create_index(
        "ix_documents_regulation_revision_id",
        "documents",
        ["regulation_revision_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_documents_regulation_revision_id",
        "documents",
        "regulation_revisions",
        ["regulation_revision_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_documents_regulation_revision_id", "documents", type_="foreignkey")
    op.drop_index("ix_documents_regulation_revision_id", table_name="documents")
    op.drop_column("documents", "regulation_revision_id")
    op.drop_column("regulation_revisions", "amended_year")
    op.drop_column("regulation_revisions", "amended_at_precision")
