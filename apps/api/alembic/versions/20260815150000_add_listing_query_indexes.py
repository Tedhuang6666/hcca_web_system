"""補強列表與可見性查詢索引

Revision ID: 20260815150000
Revises: 20260815123000
Create Date: 2026-08-15 15:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260815150000"
down_revision: str | Sequence[str] | None = "20260815123000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX ix_surveys_status_updated_at
        ON surveys (status, updated_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX ix_surveys_created_at_desc
        ON surveys (created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX ix_announcements_published_created
        ON announcements (is_published, published_at DESC NULLS LAST, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX ix_announcements_created_at_desc
        ON announcements (created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX ix_announcements_activity_published
        ON announcements (activity_id, is_published, published_at DESC NULLS LAST)
        """
    )
    op.execute(
        """
        CREATE INDEX ix_announcement_audience_orgs_org_announcement
        ON announcement_audience_orgs (org_id, announcement_id)
        """
    )
    op.execute(
        """
        CREATE INDEX ix_announcement_audience_users_user_announcement
        ON announcement_audience_users (user_id, announcement_id)
        """
    )
    op.execute(
        """
        CREATE INDEX ix_regulations_active_published_updated
        ON regulations (updated_at DESC)
        WHERE is_active = TRUE AND published_at IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX ix_products_series_status_created
        ON products (series_id, status, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX ix_user_identities_user_email
        ON user_identities (user_id, email)
        WHERE email IS NOT NULL
        """
    )


def downgrade() -> None:
    for name in (
        "ix_user_identities_user_email",
        "ix_products_series_status_created",
        "ix_regulations_active_published_updated",
        "ix_announcement_audience_users_user_announcement",
        "ix_announcement_audience_orgs_org_announcement",
        "ix_announcements_activity_published",
        "ix_announcements_created_at_desc",
        "ix_announcements_published_created",
        "ix_surveys_created_at_desc",
        "ix_surveys_status_updated_at",
    ):
        op.drop_index(name)
