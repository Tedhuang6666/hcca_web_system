"""add class target to document recipients

Revision ID: 20260722030000
Revises: 20260722020000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260722030000"
down_revision: str | Sequence[str] | None = "20260722020000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "document_recipients",
        sa.Column("target_class_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_document_recipients_target_class_id",
        "document_recipients",
        "school_classes",
        ["target_class_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_document_recipients_target_class",
        "document_recipients",
        ["target_class_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_document_recipients_target_class", table_name="document_recipients")
    op.drop_constraint(
        "fk_document_recipients_target_class_id",
        "document_recipients",
        type_="foreignkey",
    )
    op.drop_column("document_recipients", "target_class_id")
