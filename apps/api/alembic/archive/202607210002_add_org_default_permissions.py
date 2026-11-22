"""新增組織預設權限碼

Revision ID: 202607210002
Revises: 202607210001
Create Date: 2026-07-21 00:02:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "202607210002"
down_revision: str | Sequence[str] | None = "202607210001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    jsonb_type = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")
    op.add_column(
        "orgs",
        sa.Column(
            "default_permission_codes",
            jsonb_type,
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("orgs", "default_permission_codes")
