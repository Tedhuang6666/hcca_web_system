"""add org leader user id

Revision ID: 8c3b0c6d9f21
Revises: 07a5e8808eff
Create Date: 2026-06-03 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "8c3b0c6d9f21"
down_revision = "07a5e8808eff"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orgs", sa.Column("leader_user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_index("ix_orgs_leader_user_id", "orgs", ["leader_user_id"], unique=False)
    op.create_foreign_key(
        "fk_orgs_leader_user_id_users",
        "orgs",
        "users",
        ["leader_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_orgs_leader_user_id_users", "orgs", type_="foreignkey")
    op.drop_index("ix_orgs_leader_user_id", table_name="orgs")
    op.drop_column("orgs", "leader_user_id")
