"""rbac_v2_position_parent_and_serial_codes

新增 positions.parent_id（職位階層）並將 permissions.code 中的
'doc.issue' 重新命名為 'serial:create'。

Revision ID: c3d4e5f6a7b8
Revises: b7c8d9e0f1a2
Create Date: 2026-04-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c3d4e5f6a7b8"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. positions 新增 parent_id（自我參照，可為 NULL）
    op.add_column(
        "positions",
        sa.Column("parent_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_positions_parent_id",
        "positions",
        "positions",
        ["parent_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_positions_parent_id", "positions", ["parent_id"])

    # 2. 將 'doc.issue' 權限碼重命名為 'serial:create'
    op.execute("UPDATE permissions SET code = 'serial:create' WHERE code = 'doc.issue'")


def downgrade() -> None:
    op.execute("UPDATE permissions SET code = 'doc.issue' WHERE code = 'serial:create'")
    op.drop_index("ix_positions_parent_id", table_name="positions")
    op.drop_constraint("fk_positions_parent_id", "positions", type_="foreignkey")
    op.drop_column("positions", "parent_id")
