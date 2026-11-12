"""新增網站漏洞與功能問題回報。

Revision ID: 20261112100000
Revises: 20261106150000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261112100000"
down_revision: str | Sequence[str] | None = "20261106150000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "site_reports",
        sa.Column("id", UUID, nullable=False),
        sa.Column("reference_code", sa.String(32), nullable=False, unique=True),
        sa.Column("kind", sa.String(20), nullable=False, server_default="bug"),
        sa.Column("severity", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("status", sa.String(20), nullable=False, server_default="new"),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("steps_to_reproduce", sa.Text(), nullable=True),
        sa.Column("affected_url", sa.String(2000), nullable=True),
        sa.Column("contact_email", sa.String(320), nullable=True),
        sa.Column("reporter_id", UUID, nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column("reviewed_by", UUID, nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_site_reports_kind", ["kind"]),
        ("ix_site_reports_severity", ["severity"]),
        ("ix_site_reports_status", ["status"]),
        ("ix_site_reports_reporter_id", ["reporter_id"]),
        ("ix_site_reports_status_created", ["status", "created_at"]),
        ("ix_site_reports_kind_created", ["kind", "created_at"]),
    ):
        op.create_index(name, "site_reports", columns)


def downgrade() -> None:
    op.drop_table("site_reports")
