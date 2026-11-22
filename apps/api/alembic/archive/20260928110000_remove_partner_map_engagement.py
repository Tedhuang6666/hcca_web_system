"""移除特約地圖的評分、常去與熱度統計。"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260928110000"
down_revision: str | Sequence[str] | None = "20260928100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("partner_checkins")
    op.drop_table("partner_ratings")
    op.drop_column("partner_businesses", "checkin_count")
    op.drop_column("partner_businesses", "click_count")
    op.drop_column("partner_businesses", "view_count")


def downgrade() -> None:
    op.add_column(
        "partner_businesses",
        sa.Column("view_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "partner_businesses",
        sa.Column("click_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "partner_businesses",
        sa.Column("checkin_count", sa.Integer(), server_default="0", nullable=False),
    )

    op.create_table(
        "partner_ratings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("business_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("visit_count", sa.Integer(), server_default="1", nullable=False),
        sa.Column("is_public", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["business_id"], ["partner_businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "user_id", name="uq_partner_rating_user"),
    )
    op.create_index("ix_partner_ratings_business_id", "partner_ratings", ["business_id"])
    op.create_index("ix_partner_ratings_user_id", "partner_ratings", ["user_id"])
    op.create_index("ix_partner_ratings_is_public", "partner_ratings", ["is_public"])

    op.create_table(
        "partner_checkins",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("business_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["business_id"], ["partner_businesses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("business_id", "user_id", name="uq_partner_checkin_user"),
    )
    op.create_index("ix_partner_checkins_business_id", "partner_checkins", ["business_id"])
    op.create_index("ix_partner_checkins_user_id", "partner_checkins", ["user_id"])
