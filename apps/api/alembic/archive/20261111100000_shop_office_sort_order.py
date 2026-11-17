"""教師處室顯示順序。

Revision ID: 20261111100000
Revises: 20261110100000
"""

import sqlalchemy as sa
from alembic import op

revision = "20261111100000"
down_revision = "20261110100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "shop_offices", sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0")
    )
    # 保留原本依名稱與 UUID 排序的結果，之後新增處室接在末尾。
    op.execute(
        """
        UPDATE shop_offices AS office
        SET sort_order = ordered.position
        FROM (
            SELECT id, (row_number() OVER (ORDER BY name, id) - 1)::integer AS position
            FROM shop_offices
        ) AS ordered
        WHERE office.id = ordered.id
        """
    )


def downgrade() -> None:
    op.drop_column("shop_offices", "sort_order")
