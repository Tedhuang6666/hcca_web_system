"""add matter resources

Revision ID: 20260704133000
Revises: 20260704120000, 20260705100000
Create Date: 2026-07-04 13:30:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260704133000"
down_revision: str | Sequence[str] | None = ("20260704120000", "20260705100000")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "matter_resources",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("matter_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("resource_type", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=True),
        sa.Column("external_id", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "meta",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
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
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["matter_id"], ["matters.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("matter_id", "url", name="uq_matter_resources_matter_url"),
    )
    op.create_index(
        "ix_matter_resources_matter_id", "matter_resources", ["matter_id"], unique=False
    )
    op.create_index(
        "ix_matter_resources_matter_type",
        "matter_resources",
        ["matter_id", "resource_type"],
        unique=False,
    )
    op.create_index(
        "ix_matter_resources_provider",
        "matter_resources",
        ["provider", "external_id"],
        unique=False,
    )
    op.create_index(
        "ix_matter_resources_resource_type",
        "matter_resources",
        ["resource_type"],
        unique=False,
    )
    op.create_index(
        "ix_matter_resources_provider_single",
        "matter_resources",
        ["provider"],
        unique=False,
    )
    op.create_index(
        "ix_matter_resources_external_id",
        "matter_resources",
        ["external_id"],
        unique=False,
    )
    op.create_index(
        "ix_matter_resources_is_active",
        "matter_resources",
        ["is_active"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_matter_resources_is_active", table_name="matter_resources")
    op.drop_index("ix_matter_resources_external_id", table_name="matter_resources")
    op.drop_index("ix_matter_resources_provider_single", table_name="matter_resources")
    op.drop_index("ix_matter_resources_resource_type", table_name="matter_resources")
    op.drop_index("ix_matter_resources_provider", table_name="matter_resources")
    op.drop_index("ix_matter_resources_matter_type", table_name="matter_resources")
    op.drop_index("ix_matter_resources_matter_id", table_name="matter_resources")
    op.drop_table("matter_resources")
