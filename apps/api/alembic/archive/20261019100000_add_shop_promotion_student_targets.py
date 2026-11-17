"""新增校商優惠預先指定學號。

Revision ID: 20261019100000
Revises: 20261017100000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261019100000"
down_revision = "20261017100000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shop_promotion_student_targets",
        sa.Column(
            "promotion_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("shop_promotions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("student_id", sa.String(20), primary_key=True),
    )
    op.create_index(
        "ix_shop_promotion_student_targets_student_id",
        "shop_promotion_student_targets",
        ["student_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_shop_promotion_student_targets_student_id",
        table_name="shop_promotion_student_targets",
    )
    op.drop_table("shop_promotion_student_targets")
