"""將公開系統資訊合併為單一 Markdown 欄位。

Revision ID: 20260728130000
Revises: 20260728120000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260728130000"
down_revision: str | Sequence[str] | None = "20260728120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "public_site_settings",
        sa.Column("system_info_md", sa.Text(), nullable=True),
    )
    op.execute(
        """
        UPDATE public_site_settings
        SET system_info_md = concat_ws(
            E'\\n\\n',
            CASE WHEN nullif(trim(support_md), '') IS NOT NULL
                THEN '## 需要協助嗎？' || E'\\n\\n' || trim(support_md)
            END,
            CASE WHEN nullif(trim(error_report_md), '') IS NOT NULL
                THEN '## 錯誤報告' || E'\\n\\n' || trim(error_report_md)
            END,
            CASE WHEN nullif(trim(contact_md), '') IS NOT NULL
                THEN '## 聯絡資訊' || E'\\n\\n' || trim(contact_md)
            END,
            CASE WHEN nullif(trim(terms_md), '') IS NOT NULL
                THEN '## 使用者條款' || E'\\n\\n' || trim(terms_md)
            END,
            CASE WHEN nullif(trim(developer_team_md), '') IS NOT NULL
                THEN '## 開發團隊' || E'\\n\\n' || trim(developer_team_md)
            END
        )
        WHERE system_info_md IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("public_site_settings", "system_info_md")
