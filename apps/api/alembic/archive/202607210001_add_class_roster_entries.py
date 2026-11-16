"""新增班級座號與學號名冊對照

Revision ID: 202607210001
Revises: ffff8afe1b1d
Create Date: 2026-07-21 00:01:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "202607210001"
down_revision: str | Sequence[str] | None = "ffff8afe1b1d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "class_roster_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seat_number", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.String(length=20), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["class_id"], ["school_classes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("class_id", "seat_number", name="uq_class_roster_seat"),
        sa.UniqueConstraint("class_id", "student_id", name="uq_class_roster_student_id"),
    )
    op.create_index("ix_class_roster_entries_class_id", "class_roster_entries", ["class_id"])
    op.create_index("ix_class_roster_entries_user_id", "class_roster_entries", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_class_roster_entries_user_id", table_name="class_roster_entries")
    op.drop_index("ix_class_roster_entries_class_id", table_name="class_roster_entries")
    op.drop_table("class_roster_entries")
