"""add_student_id_and_is_public

新增：
- users.student_id  VARCHAR(20) UNIQUE（學號，格式 g0XXXXX）
- documents.is_public  BOOLEAN DEFAULT FALSE（公開公文標誌）

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-04-17 00:01:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c2d3e4f5a6b7"
down_revision: str | None = "b1c2d3e4f5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "student_id",
            sa.String(20),
            nullable=True,
        ),
    )
    op.create_index("ix_users_student_id", "users", ["student_id"], unique=True)

    op.add_column(
        "documents",
        sa.Column(
            "is_public",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index("ix_documents_is_public", "documents", ["is_public"])


def downgrade() -> None:
    op.drop_index("ix_documents_is_public", table_name="documents")
    op.drop_column("documents", "is_public")
    op.drop_index("ix_users_student_id", table_name="users")
    op.drop_column("users", "student_id")
