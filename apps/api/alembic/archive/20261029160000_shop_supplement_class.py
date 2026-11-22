"""保留補收款訂單的原班級快照。

Revision ID: 20261029160000
Revises: 20261028220000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261029160000"
down_revision = "20261028220000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("supplement_class_id", postgresql.UUID(as_uuid=True)))
    op.create_foreign_key(
        "fk_orders_supplement_class_id",
        "orders",
        "school_classes",
        ["supplement_class_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint("fk_orders_supplement_class_id", "orders", type_="foreignkey")
    op.drop_column("orders", "supplement_class_id")
