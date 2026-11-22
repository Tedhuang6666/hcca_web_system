"""公開網站系統資訊欄位。

Revision ID: 20260728120000
Revises: 20260726010000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260728120000"
down_revision: str | Sequence[str] | None = "20260726010000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    defaults = {
        "support_md": "若使用平台時遇到問題，請先查看最新公告；仍需要協助時，請透過下方聯絡資訊與管理團隊聯繫。",
        "error_report_md": "回報錯誤時，請提供發生時間、操作步驟與畫面；請勿在公開內容中填寫密碼或其他敏感資料。",
    }
    for name in ("support_md", "error_report_md", "contact_md", "terms_md", "developer_team_md"):
        default = sa.text(f"'{defaults[name]}'") if name in defaults else None
        op.add_column(
            "public_site_settings",
            sa.Column(name, sa.Text(), nullable=True, server_default=default),
        )

    for name in defaults:
        op.alter_column("public_site_settings", name, server_default=None)


def downgrade() -> None:
    for name in ("developer_team_md", "terms_md", "contact_md", "error_report_md", "support_md"):
        op.drop_column("public_site_settings", name)
