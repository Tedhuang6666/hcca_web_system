"""add people affiliations

Revision ID: 20260601090000
Revises: 20260531173000, 9a8b7c6d5e4f, a1b2c3d4e5f7, a7a7f56cc127, a7b8c9d0e1f2, f5a6b7c8d9e0
Create Date: 2026-06-01 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260601090000"
down_revision = ("20260531173000", "a7a7f56cc127")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "people",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("student_id", sa.String(length=20), nullable=True),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("legal_name", sa.String(length=100), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="active", nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("student_id", name="uq_people_student_id"),
        sa.UniqueConstraint("user_id", name="uq_people_user_id"),
    )
    op.create_index("ix_people_display_name", "people", ["display_name"], unique=False)
    op.create_index("ix_people_email", "people", ["email"], unique=False)
    op.create_index("ix_people_status", "people", ["status"], unique=False)
    op.create_index("ix_people_student_id", "people", ["student_id"], unique=False)
    op.create_index("ix_people_user_id", "people", ["user_id"], unique=False)

    op.create_table(
        "person_affiliations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("person_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("academic_year", sa.Integer(), nullable=True),
        sa.Column("class_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("position_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("role_key", sa.String(length=50), nullable=True),
        sa.Column("title", sa.String(length=100), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="active", nullable=False),
        sa.Column("source", sa.String(length=30), server_default="manual", nullable=False),
        sa.Column("synced_user_position_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["class_id"], ["school_classes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["person_id"], ["people.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["position_id"], ["positions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["synced_user_position_id"], ["user_positions.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_person_affiliations_class_kind",
        "person_affiliations",
        ["class_id", "kind"],
        unique=False,
    )
    op.create_index(
        "ix_person_affiliations_kind_status",
        "person_affiliations",
        ["kind", "status"],
        unique=False,
    )
    op.create_index(
        "ix_person_affiliations_org_kind",
        "person_affiliations",
        ["org_id", "kind"],
        unique=False,
    )
    op.create_index(
        "ix_person_affiliations_person_id",
        "person_affiliations",
        ["person_id"],
        unique=False,
    )
    op.create_index(
        "ix_person_affiliations_person_status",
        "person_affiliations",
        ["person_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_person_affiliations_position",
        "person_affiliations",
        ["position_id"],
        unique=False,
    )
    op.create_index(
        "ix_person_affiliations_role_key",
        "person_affiliations",
        ["role_key"],
        unique=False,
    )
    op.create_index(
        "ix_person_affiliations_synced_up",
        "person_affiliations",
        ["synced_user_position_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_person_affiliations_synced_up", table_name="person_affiliations")
    op.drop_index("ix_person_affiliations_role_key", table_name="person_affiliations")
    op.drop_index("ix_person_affiliations_position", table_name="person_affiliations")
    op.drop_index("ix_person_affiliations_person_status", table_name="person_affiliations")
    op.drop_index("ix_person_affiliations_person_id", table_name="person_affiliations")
    op.drop_index("ix_person_affiliations_org_kind", table_name="person_affiliations")
    op.drop_index("ix_person_affiliations_kind_status", table_name="person_affiliations")
    op.drop_index("ix_person_affiliations_class_kind", table_name="person_affiliations")
    op.drop_table("person_affiliations")
    op.drop_index("ix_people_user_id", table_name="people")
    op.drop_index("ix_people_student_id", table_name="people")
    op.drop_index("ix_people_status", table_name="people")
    op.drop_index("ix_people_email", table_name="people")
    op.drop_index("ix_people_display_name", table_name="people")
    op.drop_table("people")
