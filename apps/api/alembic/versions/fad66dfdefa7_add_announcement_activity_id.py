"""新增 activities / calendar 功能表與各模組 activity_id 連結欄位

此 migration 僅做「補上模型已有、但資料庫缺少」的新增性變更：
  - 建立缺失的 activities / calendar_events / activity_conveners /
    calendar_event_* 表
  - 為 announcements / documents / surveys / product_categories 新增
    activity_id 外鍵欄位（指向 activities）

刻意不處理 autogenerate 另外偵測到的不相關漂移（drop search_vector、
partner_* NOT NULL、discord/line 唯一約束改名、meeting_attendance 索引），
那些屬於另一批決策，且部分具破壞性／可能在既有資料上失敗。

Revision ID: fad66dfdefa7
Revises: 20260529140000
Create Date: 2026-05-29 21:14:55.213526

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fad66dfdefa7"
down_revision: str | Sequence[str] | None = "20260529140000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "activities",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("org_id", sa.UUID(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_activities_active_status", "activities", ["is_active", "status"], unique=False
    )
    op.create_index(op.f("ix_activities_is_active"), "activities", ["is_active"], unique=False)
    op.create_index(op.f("ix_activities_name"), "activities", ["name"], unique=False)
    op.create_index(op.f("ix_activities_org_id"), "activities", ["org_id"], unique=False)
    op.create_index("ix_activities_org_status", "activities", ["org_id", "status"], unique=False)
    op.create_index(op.f("ix_activities_status"), "activities", ["status"], unique=False)

    op.create_table(
        "calendar_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("event_type", sa.String(length=30), server_default="activity", nullable=False),
        sa.Column("status", sa.String(length=20), server_default="confirmed", nullable=False),
        sa.Column("visibility", sa.String(length=20), server_default="org", nullable=False),
        sa.Column("location", sa.String(length=200), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("all_day", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("source_meeting_id", sa.UUID(), nullable=True),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("updated_by", sa.UUID(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["source_meeting_id"], ["meetings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_meeting_id", name="uq_calendar_events_source_meeting"),
    )
    op.create_index(
        op.f("ix_calendar_events_event_type"), "calendar_events", ["event_type"], unique=False
    )
    op.create_index(
        op.f("ix_calendar_events_is_active"), "calendar_events", ["is_active"], unique=False
    )
    op.create_index(op.f("ix_calendar_events_org_id"), "calendar_events", ["org_id"], unique=False)
    op.create_index(
        "ix_calendar_events_org_range",
        "calendar_events",
        ["org_id", "starts_at", "ends_at"],
        unique=False,
    )
    op.create_index(
        "ix_calendar_events_range", "calendar_events", ["starts_at", "ends_at"], unique=False
    )
    op.create_index(
        op.f("ix_calendar_events_source_meeting_id"),
        "calendar_events",
        ["source_meeting_id"],
        unique=False,
    )
    op.create_index(op.f("ix_calendar_events_status"), "calendar_events", ["status"], unique=False)
    op.create_index(
        "ix_calendar_events_type_status", "calendar_events", ["event_type", "status"], unique=False
    )
    op.create_index(
        op.f("ix_calendar_events_visibility"), "calendar_events", ["visibility"], unique=False
    )

    op.create_table(
        "activity_conveners",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("activity_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "activity_id", "user_id", "start_date", name="uq_activity_convener_term"
        ),
    )
    op.create_index(
        "ix_activity_conveners_active",
        "activity_conveners",
        ["activity_id", "user_id", "end_date"],
        unique=False,
    )
    op.create_index(
        op.f("ix_activity_conveners_user_id"), "activity_conveners", ["user_id"], unique=False
    )

    op.create_table(
        "calendar_event_checklist_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("event_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assignee_id", sa.UUID(), nullable=True),
        sa.Column("is_done", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["assignee_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["event_id"], ["calendar_events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_calendar_event_checklist_event_done",
        "calendar_event_checklist_items",
        ["event_id", "is_done"],
        unique=False,
    )
    op.create_index(
        op.f("ix_calendar_event_checklist_items_assignee_id"),
        "calendar_event_checklist_items",
        ["assignee_id"],
        unique=False,
    )

    op.create_table(
        "calendar_event_links",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("event_id", sa.UUID(), nullable=False),
        sa.Column("link_type", sa.String(length=30), nullable=False),
        sa.Column("object_id", sa.UUID(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=True),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["event_id"], ["calendar_events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_calendar_event_links_event_type",
        "calendar_event_links",
        ["event_id", "link_type"],
        unique=False,
    )

    op.create_table(
        "calendar_event_participants",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("event_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(length=20), server_default="required", nullable=False),
        sa.Column("response", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["event_id"], ["calendar_events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "user_id", name="uq_calendar_event_participant_user"),
    )
    op.create_index(
        "ix_calendar_event_participants_user",
        "calendar_event_participants",
        ["user_id", "response"],
        unique=False,
    )
    op.create_index(
        op.f("ix_calendar_event_participants_user_id"),
        "calendar_event_participants",
        ["user_id"],
        unique=False,
    )

    # activity_id 連結欄位（指向 activities）
    for table in ("announcements", "documents", "surveys", "product_categories"):
        op.add_column(table, sa.Column("activity_id", sa.UUID(), nullable=True))
        op.create_index(f"ix_{table}_activity_id", table, ["activity_id"], unique=False)
        op.create_foreign_key(
            f"fk_{table}_activity_id",
            table,
            "activities",
            ["activity_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    """Downgrade schema."""
    for table in ("product_categories", "surveys", "documents", "announcements"):
        op.drop_constraint(f"fk_{table}_activity_id", table, type_="foreignkey")
        op.drop_index(f"ix_{table}_activity_id", table_name=table)
        op.drop_column(table, "activity_id")

    op.drop_table("calendar_event_participants")
    op.drop_table("calendar_event_links")
    op.drop_table("calendar_event_checklist_items")
    op.drop_table("activity_conveners")
    op.drop_table("calendar_events")
    op.drop_table("activities")
