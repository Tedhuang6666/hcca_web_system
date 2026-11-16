"""新增問卷公告連結設定

Revision ID: 20260922120000
Revises: 20260921110000
Create Date: 2026-09-22 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260922120000"
down_revision: str | Sequence[str] | None = "20260921110000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("surveys", sa.Column("announcement", sa.Text(), nullable=True))
    op.add_column("surveys", sa.Column("announcement_title", sa.String(length=200), nullable=True))
    op.add_column(
        "surveys",
        sa.Column(
            "show_announcement_popup",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "surveys",
        sa.Column("announcement_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_surveys_announcement_id",
        "surveys",
        "announcements",
        ["announcement_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_surveys_announcement_id", "surveys", type_="foreignkey")
    op.drop_column("surveys", "announcement_id")
    op.drop_column("surveys", "show_announcement_popup")
    op.drop_column("surveys", "announcement_title")
    op.drop_column("surveys", "announcement")
