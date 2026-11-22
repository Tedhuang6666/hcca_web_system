"""rename survey allowed_emails_json to allowed_user_ids_json

Revision ID: 20260518130000
Revises: 20260518120000
Create Date: 2026-05-18 13:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260518130000"
down_revision: str | Sequence[str] | None = "20260518120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("surveys", "allowed_emails_json", new_column_name="allowed_user_ids_json")


def downgrade() -> None:
    op.alter_column("surveys", "allowed_user_ids_json", new_column_name="allowed_emails_json")
