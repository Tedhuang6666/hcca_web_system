"""add recipient targets and delivery method

Revision ID: 20260525030000
Revises: 20260525020000
Create Date: 2026-05-25 03:00:00.000000

新增 DocumentRecipient 結構化目標欄位（target_user_id / target_org_id）
與遞送方式 enum（delivery_method）。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260525030000"
down_revision: str | Sequence[str] | None = "20260525020000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


DELIVERY_METHOD_VALUES = ("none", "system", "email", "paper", "postal")


def upgrade() -> None:
    # 建立 enum 類型（PostgreSQL 原生 enum）
    delivery_method_enum = postgresql.ENUM(
        *DELIVERY_METHOD_VALUES,
        name="deliverymethod",
        create_type=False,
    )
    delivery_method_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "document_recipients",
        sa.Column("target_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "document_recipients",
        sa.Column("target_org_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "document_recipients",
        sa.Column(
            "delivery_method",
            sa.Enum(*DELIVERY_METHOD_VALUES, name="deliverymethod"),
            nullable=False,
            server_default="none",
        ),
    )
    op.create_foreign_key(
        "fk_document_recipients_target_user",
        "document_recipients",
        "users",
        ["target_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_document_recipients_target_org",
        "document_recipients",
        "orgs",
        ["target_org_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_document_recipients_target_user",
        "document_recipients",
        ["target_user_id"],
    )
    op.create_index(
        "ix_document_recipients_target_org",
        "document_recipients",
        ["target_org_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_document_recipients_target_org", table_name="document_recipients")
    op.drop_index("ix_document_recipients_target_user", table_name="document_recipients")
    op.drop_constraint(
        "fk_document_recipients_target_org",
        "document_recipients",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_document_recipients_target_user",
        "document_recipients",
        type_="foreignkey",
    )
    op.drop_column("document_recipients", "delivery_method")
    op.drop_column("document_recipients", "target_org_id")
    op.drop_column("document_recipients", "target_user_id")
    sa.Enum(name="deliverymethod").drop(op.get_bind(), checkfirst=True)
