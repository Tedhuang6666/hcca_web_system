"""新增店家帳號授權與結構化營業時間。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260729130000"
down_revision: str | Sequence[str] | None = "20260729110000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    json_type = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")

    op.add_column(
        "partner_businesses",
        sa.Column(
            "business_hours", json_type, server_default=sa.text("'{}'::jsonb"), nullable=False
        ),
    )
    op.add_column(
        "recommended_vendors",
        sa.Column(
            "business_hours", json_type, server_default=sa.text("'{}'::jsonb"), nullable=False
        ),
    )
    op.create_table(
        "partner_business_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("business_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("granted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["business_id"], ["partner_businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["granted_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "business_id", "user_id", name="uq_partner_business_accounts_business_user"
        ),
    )
    op.create_index(
        "ix_partner_business_accounts_business_id",
        "partner_business_accounts",
        ["business_id"],
    )
    op.create_index(
        "ix_partner_business_accounts_user_id", "partner_business_accounts", ["user_id"]
    )
    op.create_index(
        "ix_partner_business_accounts_is_active", "partner_business_accounts", ["is_active"]
    )


def downgrade() -> None:
    op.drop_index("ix_partner_business_accounts_is_active", table_name="partner_business_accounts")
    op.drop_index("ix_partner_business_accounts_user_id", table_name="partner_business_accounts")
    op.drop_index(
        "ix_partner_business_accounts_business_id", table_name="partner_business_accounts"
    )
    op.drop_table("partner_business_accounts")
    op.drop_column("recommended_vendors", "business_hours")
    op.drop_column("partner_businesses", "business_hours")
