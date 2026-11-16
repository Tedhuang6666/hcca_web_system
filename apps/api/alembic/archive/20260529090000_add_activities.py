"""add activities

Revision ID: 20260529090000
Revises: 20260528110000
Create Date: 2026-05-29 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260529090000"
down_revision: str | Sequence[str] | None = "20260528110000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "activities",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_activities_active_status", "activities", ["is_active", "status"])
    op.create_index("ix_activities_is_active", "activities", ["is_active"])
    op.create_index("ix_activities_name", "activities", ["name"])
    op.create_index("ix_activities_org_id", "activities", ["org_id"])
    op.create_index("ix_activities_org_status", "activities", ["org_id", "status"])
    op.create_index("ix_activities_status", "activities", ["status"])

    op.create_table(
        "activity_conveners",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("activity_id", "user_id", "start_date", name="uq_activity_convener_term"),
    )
    op.create_index(
        "ix_activity_conveners_active", "activity_conveners", ["activity_id", "user_id", "end_date"]
    )
    op.create_index("ix_activity_conveners_user_id", "activity_conveners", ["user_id"])

    op.add_column("announcements", sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_announcements_activity_id_activities",
        "announcements",
        "activities",
        ["activity_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_announcements_activity_id", "announcements", ["activity_id"])

    op.add_column("surveys", sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_surveys_activity_id_activities",
        "surveys",
        "activities",
        ["activity_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_surveys_activity_id", "surveys", ["activity_id"])

    op.add_column(
        "product_categories",
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_product_categories_activity_id_activities",
        "product_categories",
        "activities",
        ["activity_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_product_categories_activity_id", "product_categories", ["activity_id"])

    op.add_column("documents", sa.Column("activity_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_documents_activity_id_activities",
        "documents",
        "activities",
        ["activity_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_documents_activity_id", "documents", ["activity_id"])


def downgrade() -> None:
    op.drop_index("ix_documents_activity_id", table_name="documents")
    op.drop_constraint("fk_documents_activity_id_activities", "documents", type_="foreignkey")
    op.drop_column("documents", "activity_id")

    op.drop_index("ix_product_categories_activity_id", table_name="product_categories")
    op.drop_constraint(
        "fk_product_categories_activity_id_activities", "product_categories", type_="foreignkey"
    )
    op.drop_column("product_categories", "activity_id")

    op.drop_index("ix_surveys_activity_id", table_name="surveys")
    op.drop_constraint("fk_surveys_activity_id_activities", "surveys", type_="foreignkey")
    op.drop_column("surveys", "activity_id")

    op.drop_index("ix_announcements_activity_id", table_name="announcements")
    op.drop_constraint("fk_announcements_activity_id_activities", "announcements", type_="foreignkey")
    op.drop_column("announcements", "activity_id")

    op.drop_index("ix_activity_conveners_user_id", table_name="activity_conveners")
    op.drop_index("ix_activity_conveners_active", table_name="activity_conveners")
    op.drop_table("activity_conveners")

    op.drop_index("ix_activities_status", table_name="activities")
    op.drop_index("ix_activities_org_status", table_name="activities")
    op.drop_index("ix_activities_org_id", table_name="activities")
    op.drop_index("ix_activities_name", table_name="activities")
    op.drop_index("ix_activities_is_active", table_name="activities")
    op.drop_index("ix_activities_active_status", table_name="activities")
    op.drop_table("activities")
