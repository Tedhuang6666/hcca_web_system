"""補齊投稿設定與導覽JSON型別

Revision ID: ffff8afe1b1d
Revises: a46fd15e77d1
Create Date: 2026-07-20 02:37:51.078114

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "ffff8afe1b1d"
down_revision: str | Sequence[str] | None = "a46fd15e77d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "merchandise_submission_settings",
        sa.Column("require_school_email", sa.Boolean(), server_default="true", nullable=False),
    )
    jsonb_type = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")
    for column in (
        "match_any_permissions",
        "match_any_prefixes",
        "exclude_permissions",
        "exclude_prefixes",
        "desktop_sections",
        "mobile_order",
    ):
        op.alter_column(
            "navigation_profiles",
            column,
            existing_type=postgresql.JSON(astext_type=sa.Text()),
            type_=jsonb_type,
            existing_nullable=False,
            postgresql_using=f"{column}::jsonb",
        )


def downgrade() -> None:
    """Downgrade schema."""
    jsonb_type = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")
    for column in (
        "mobile_order",
        "desktop_sections",
        "exclude_prefixes",
        "exclude_permissions",
        "match_any_prefixes",
        "match_any_permissions",
    ):
        op.alter_column(
            "navigation_profiles",
            column,
            existing_type=jsonb_type,
            type_=postgresql.JSON(astext_type=sa.Text()),
            existing_nullable=False,
            postgresql_using=f"{column}::json",
        )
    op.drop_column("merchandise_submission_settings", "require_school_email")
