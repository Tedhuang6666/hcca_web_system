"""新增班級歸戶更正申請"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260929150000"
down_revision: str | Sequence[str] | None = "20260929130000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "class_correction_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reported_class_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("requested_class_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("resolved_class_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("reviewed_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reported_class_id"], ["school_classes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["requested_class_id"], ["school_classes.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["resolved_class_id"], ["school_classes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_class_correction_requests_status",
        ),
    )
    op.create_index(
        "ix_class_correction_requests_user_id",
        "class_correction_requests",
        ["user_id"],
    )
    op.create_index(
        "ix_class_correction_requests_status_created",
        "class_correction_requests",
        ["status", "created_at"],
    )
    op.create_index(
        "ix_class_correction_requests_user_status",
        "class_correction_requests",
        ["user_id", "status"],
    )
    op.create_index(
        "uq_class_correction_pending_user",
        "class_correction_requests",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
        sqlite_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index("uq_class_correction_pending_user", table_name="class_correction_requests")
    op.drop_index(
        "ix_class_correction_requests_user_status", table_name="class_correction_requests"
    )
    op.drop_index(
        "ix_class_correction_requests_status_created", table_name="class_correction_requests"
    )
    op.drop_index("ix_class_correction_requests_user_id", table_name="class_correction_requests")
    op.drop_table("class_correction_requests")
