"""商品教師訂購資料與處室選項。

Revision ID: 20261109100000
Revises: 20261106150000
"""

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261109100000"
down_revision = "20261106150000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    offices = op.create_table(
        "shop_offices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.bulk_insert(
        offices,
        [
            {"id": uuid.UUID("1c606889-2e10-47c5-bf3f-aef4da985cef"), "name": "國文科"},
            {"id": uuid.UUID("f0cf65ef-042e-472e-9a57-5f580923c370"), "name": "學務處"},
        ],
    )
    op.create_table(
        "shop_teacher_profiles",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "office_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("shop_offices.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.add_column("orders", sa.Column("buyer_name", sa.String(100), nullable=True))
    op.add_column("orders", sa.Column("buyer_office", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "buyer_office")
    op.drop_column("orders", "buyer_name")
    op.drop_table("shop_teacher_profiles")
    op.drop_table("shop_offices")
