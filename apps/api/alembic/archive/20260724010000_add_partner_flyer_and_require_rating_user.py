"""add partner flyer and require rating user

Revision ID: 20260724010000
Revises: 20260722040000
Create Date: 2026-07-24 01:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260724010000"
down_revision: str | Sequence[str] | None = "20260722040000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("partner_businesses", sa.Column("flyer_storage_key", sa.Text(), nullable=True))
    op.add_column(
        "partner_businesses", sa.Column("flyer_filename", sa.String(length=255), nullable=True)
    )
    op.add_column(
        "partner_businesses",
        sa.Column("flyer_content_type", sa.String(length=120), nullable=True),
    )

    # Anonymous ratings could be inserted repeatedly because PostgreSQL allows
    # multiple NULL values in a unique constraint. They have no trustworthy owner,
    # so remove them before requiring every rating to belong to a user.
    op.execute(sa.text("DELETE FROM partner_ratings WHERE user_id IS NULL"))
    op.drop_constraint("uq_partner_rating_user", "partner_ratings", type_="unique")
    op.drop_constraint("partner_ratings_user_id_fkey", "partner_ratings", type_="foreignkey")
    op.alter_column("partner_ratings", "user_id", existing_type=sa.UUID(), nullable=False)
    op.create_foreign_key(
        "fk_partner_ratings_user_id_users",
        "partner_ratings",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_partner_rating_user", "partner_ratings", ["business_id", "user_id"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_partner_rating_user", "partner_ratings", type_="unique")
    op.drop_constraint("fk_partner_ratings_user_id_users", "partner_ratings", type_="foreignkey")
    op.alter_column("partner_ratings", "user_id", existing_type=sa.UUID(), nullable=True)
    op.create_foreign_key(
        "fk_partner_ratings_user_id_users",
        "partner_ratings",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_unique_constraint(
        "uq_partner_rating_user", "partner_ratings", ["business_id", "user_id"]
    )
    op.drop_column("partner_businesses", "flyer_content_type")
    op.drop_column("partner_businesses", "flyer_filename")
    op.drop_column("partner_businesses", "flyer_storage_key")
