"""add defense rules

Revision ID: 20260525020000
Revises: 20260525010000
Create Date: 2026-05-25 02:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260525020000"
down_revision: str | Sequence[str] | None = "20260525010000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "defense_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("rule_type", sa.String(length=40), nullable=False),
        sa.Column("target", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("reason", sa.Text(), server_default="", nullable=False),
        sa.Column(
            "config",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
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
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_defense_rules_active", "defense_rules", ["is_active"], unique=False)
    op.create_index("ix_defense_rules_expires_at", "defense_rules", ["expires_at"], unique=False)
    op.create_index(
        "ix_defense_rules_type_target",
        "defense_rules",
        ["rule_type", "target"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_defense_rules_type_target", table_name="defense_rules")
    op.drop_index("ix_defense_rules_expires_at", table_name="defense_rules")
    op.drop_index("ix_defense_rules_active", table_name="defense_rules")
    op.drop_table("defense_rules")
