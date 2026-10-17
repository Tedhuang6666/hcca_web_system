"""新增學生班級確認紀錄。

Revision ID: 20261017100000
Revises: 20261011100000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261017100000"
down_revision = "20261011100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "class_confirmations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "class_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("school_classes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("student_id", sa.String(20), nullable=False),
        sa.Column("seat_number", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("seat_number BETWEEN 1 AND 999", name="ck_confirmation_seat"),
    )
    op.create_index("ix_class_confirmations_user_id", "class_confirmations", ["user_id"])
    op.create_index("ix_class_confirmations_class_id", "class_confirmations", ["class_id"])


def downgrade() -> None:
    op.drop_table("class_confirmations")
