"""add class manual members

Revision ID: 20260521110000
Revises: 20260521100000
Create Date: 2026-05-21 11:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260521110000"
down_revision: str | Sequence[str] | None = "20260521100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOW = sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "class_manual_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["class_id"], ["school_classes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("class_id", "user_id", name="uq_class_manual_member"),
    )
    op.create_index("ix_class_manual_members_class_id", "class_manual_members", ["class_id"])
    op.create_index("ix_class_manual_members_user_id", "class_manual_members", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_class_manual_members_user_id", table_name="class_manual_members")
    op.drop_index("ix_class_manual_members_class_id", table_name="class_manual_members")
    op.drop_table("class_manual_members")
