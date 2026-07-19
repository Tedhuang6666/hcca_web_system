"""強化重要公告連結導向

Revision ID: e70b436041f3
Revises: 10f28626ce9c
Create Date: 2026-07-20 03:10:15.440800

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e70b436041f3"
down_revision: str | Sequence[str] | None = "10f28626ce9c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("announcements", sa.Column("link_url", sa.String(length=500), nullable=True))
    op.add_column("announcements", sa.Column("link_label", sa.String(length=60), nullable=True))
    op.add_column(
        "announcements",
        sa.Column("show_on_every_visit", sa.Boolean(), server_default="false", nullable=False),
    )
    op.execute(
        """
        UPDATE announcements AS announcement
        SET
            is_urgent = settings.show_announcement_popup,
            urgent_until = CASE
                WHEN settings.show_announcement_popup THEN settings.closes_at
                ELSE NULL
            END,
            link_url = '/merchandise-submissions',
            link_label = '前往投稿',
            show_on_every_visit = settings.show_announcement_popup
        FROM merchandise_submission_settings AS settings
        WHERE announcement.id = settings.announcement_id
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("announcements", "show_on_every_visit")
    op.drop_column("announcements", "link_label")
    op.drop_column("announcements", "link_url")
