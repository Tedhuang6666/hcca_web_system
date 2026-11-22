"""新增特約商家申請表單與審核資料。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260729100000"
down_revision: str | Sequence[str] | None = "20260728170000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    json_type = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")

    op.create_table(
        "partner_application_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("is_open", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "title",
            sa.String(length=200),
            server_default="申請成為特約商家",
            nullable=False,
        ),
        sa.Column(
            "intro",
            sa.Text(),
            server_default="留下合作資訊，班聯會會在收到申請後與您聯繫。",
            nullable=False,
        ),
        sa.Column("privacy_notice", sa.Text(), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "partner_application_fields",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("settings_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(length=50), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("field_type", sa.String(length=20), server_default="text", nullable=False),
        sa.Column("required", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("placeholder", sa.String(length=200), nullable=True),
        sa.Column("help_text", sa.String(length=500), nullable=True),
        sa.Column("options", json_type, nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["settings_id"], ["partner_application_settings.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("settings_id", "key", name="uq_partner_application_fields_key"),
    )
    op.create_index(
        "ix_partner_application_fields_settings_id",
        "partner_application_fields",
        ["settings_id"],
    )
    op.create_index(
        "ix_partner_application_fields_is_active",
        "partner_application_fields",
        ["is_active"],
    )

    op.create_table(
        "partner_business_applications",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("field_values", json_type, nullable=False),
        sa.Column("submitted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("business_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["submitted_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["business_id"], ["partner_businesses.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_partner_business_applications_status",
        "partner_business_applications",
        ["status"],
    )
    op.create_index(
        "ix_partner_business_applications_submitted_by",
        "partner_business_applications",
        ["submitted_by"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_partner_business_applications_submitted_by",
        table_name="partner_business_applications",
    )
    op.drop_index(
        "ix_partner_business_applications_status",
        table_name="partner_business_applications",
    )
    op.drop_table("partner_business_applications")

    op.drop_index(
        "ix_partner_application_fields_is_active",
        table_name="partner_application_fields",
    )
    op.drop_index(
        "ix_partner_application_fields_settings_id",
        table_name="partner_application_fields",
    )
    op.drop_table("partner_application_fields")
    op.drop_table("partner_application_settings")
