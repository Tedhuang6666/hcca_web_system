"""add regulation tree fields

Revision ID: a9c1d2e3f4g5
Revises: f1a2b3c4d5e6
Create Date: 2026-05-03 17:35:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a9c1d2e3f4g5"
down_revision: str | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("regulation_articles", sa.Column("order_index", sa.Integer(), nullable=True))
    op.add_column(
        "regulation_articles",
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("regulation_articles", sa.Column("legal_number", sa.String(length=50), nullable=True))
    op.add_column("regulation_revisions", sa.Column("article_snapshot", sa.Text(), nullable=True))

    op.execute("UPDATE regulation_articles SET order_index = COALESCE(sort_index, 0)")
    op.execute("UPDATE regulation_revisions SET article_snapshot = '[]' WHERE article_snapshot IS NULL")

    op.alter_column("regulation_articles", "order_index", nullable=False)
    op.alter_column("regulation_revisions", "article_snapshot", nullable=False)
    op.create_index(
        op.f("ix_regulation_articles_parent_id"), "regulation_articles", ["parent_id"], unique=False
    )
    op.create_foreign_key(
        "fk_regulation_articles_parent_id",
        "regulation_articles",
        "regulation_articles",
        ["parent_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_regulation_articles_parent_id", "regulation_articles", type_="foreignkey")
    op.drop_index(op.f("ix_regulation_articles_parent_id"), table_name="regulation_articles")
    op.drop_column("regulation_revisions", "article_snapshot")
    op.drop_column("regulation_articles", "legal_number")
    op.drop_column("regulation_articles", "parent_id")
    op.drop_column("regulation_articles", "order_index")
