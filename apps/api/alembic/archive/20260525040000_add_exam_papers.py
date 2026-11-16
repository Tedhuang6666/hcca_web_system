"""add exam paper traceable downloads

Revision ID: 20260525040000
Revises: 20260525030000
Create Date: 2026-05-25 04:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260525040000"
down_revision: str | Sequence[str] | None = "20260525030000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

GRADE_TRACK_VALUES = ("first", "second", "third")


def upgrade() -> None:
    grade_track_enum = postgresql.ENUM(
        *GRADE_TRACK_VALUES,
        name="examgradetrack",
        create_type=False,
    )
    grade_track_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "exam_papers",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("subject", sa.String(length=80), nullable=False),
        sa.Column("academic_year", sa.Integer(), nullable=False),
        sa.Column("semester", sa.Integer(), nullable=False),
        sa.Column("grade", sa.Integer(), nullable=False),
        sa.Column("grade_track", grade_track_enum, nullable=True),
        sa.Column("exam_number", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("storage_key", sa.String(length=500), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("is_published", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_exam_papers_subject", "exam_papers", ["subject"])
    op.create_index("ix_exam_papers_academic_year", "exam_papers", ["academic_year"])
    op.create_index("ix_exam_papers_semester", "exam_papers", ["semester"])
    op.create_index("ix_exam_papers_grade", "exam_papers", ["grade"])
    op.create_index("ix_exam_papers_grade_track", "exam_papers", ["grade_track"])
    op.create_index("ix_exam_papers_exam_number", "exam_papers", ["exam_number"])
    op.create_index("ix_exam_papers_is_published", "exam_papers", ["is_published"])
    op.create_index("ix_exam_papers_is_active", "exam_papers", ["is_active"])
    op.create_index(
        "ix_exam_papers_filters",
        "exam_papers",
        ["is_published", "academic_year", "semester", "grade", "grade_track"],
    )

    op.create_table(
        "exam_paper_downloads",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("paper_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("trace_code", sa.String(length=40), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("downloaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["paper_id"], ["exam_papers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("trace_code", name="uq_exam_paper_download_trace_code"),
    )
    op.create_index(
        "ix_exam_paper_downloads_paper_created",
        "exam_paper_downloads",
        ["paper_id", "downloaded_at"],
    )
    op.create_index("ix_exam_paper_downloads_user", "exam_paper_downloads", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_exam_paper_downloads_user", table_name="exam_paper_downloads")
    op.drop_index("ix_exam_paper_downloads_paper_created", table_name="exam_paper_downloads")
    op.drop_table("exam_paper_downloads")
    op.drop_index("ix_exam_papers_filters", table_name="exam_papers")
    op.drop_index("ix_exam_papers_is_active", table_name="exam_papers")
    op.drop_index("ix_exam_papers_is_published", table_name="exam_papers")
    op.drop_index("ix_exam_papers_exam_number", table_name="exam_papers")
    op.drop_index("ix_exam_papers_grade_track", table_name="exam_papers")
    op.drop_index("ix_exam_papers_grade", table_name="exam_papers")
    op.drop_index("ix_exam_papers_semester", table_name="exam_papers")
    op.drop_index("ix_exam_papers_academic_year", table_name="exam_papers")
    op.drop_index("ix_exam_papers_subject", table_name="exam_papers")
    op.drop_table("exam_papers")

    grade_track_enum = postgresql.ENUM(
        *GRADE_TRACK_VALUES,
        name="examgradetrack",
        create_type=False,
    )
    grade_track_enum.drop(op.get_bind(), checkfirst=True)
