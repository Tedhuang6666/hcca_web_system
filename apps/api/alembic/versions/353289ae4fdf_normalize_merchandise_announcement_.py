"""normalize_merchandise_announcement_content

Revision ID: 353289ae4fdf
Revises: 20260720040000
Create Date: 2026-07-20 03:31:39.041384

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "353289ae4fdf"
down_revision: str | Sequence[str] | None = "20260720040000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """將既有校商公告轉成公告模組使用的 Markdown 格式。"""
    op.execute(
        """
        UPDATE announcements AS announcement
        SET content = jsonb_build_object(
            'format', 'markdown',
            'markdown', settings.announcement
        )
        FROM merchandise_submission_settings AS settings
        WHERE announcement.id = settings.announcement_id
          AND COALESCE(BTRIM(settings.announcement), '') <> ''
        """
    )


def downgrade() -> None:
    """資料格式無損回退不可行，保留已轉換內容。"""
