"""add visibility_level, display_name, announcements tables

Revision ID: a8b9c0d1e2f3
Revises: f1a2b3c4d5e6
Create Date: 2026-05-02 10:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a8b9c0d1e2f3"
down_revision: str | Sequence[str] | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. 新增 documentvisibility enum 型別
    documentvisibility = postgresql.ENUM(
        "subject_only", "org_only", "public", "publicly_open",
        name="documentvisibility",
    )
    documentvisibility.create(op.get_bind(), checkfirst=True)

    # 2. Document 新增 visibility_level 欄位（預設 org_only）
    op.add_column(
        "documents",
        sa.Column(
            "visibility_level",
            sa.Enum(
                "subject_only", "org_only", "public", "publicly_open",
                name="documentvisibility",
            ),
            nullable=False,
            server_default="org_only",
        ),
    )
    op.create_index("ix_documents_visibility_level", "documents", ["visibility_level"])

    # 3. DocumentAttachment 新增 display_name 欄位
    op.add_column(
        "document_attachments",
        sa.Column("display_name", sa.String(255), nullable=True),
    )

    # 4. 建立 announcements 表
    op.create_table(
        "announcements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("content", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("is_urgent", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("urgent_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_published", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), nullable=False),
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
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_announcements_is_urgent", "announcements", ["is_urgent"])
    op.create_index("ix_announcements_is_published", "announcements", ["is_published"])
    op.create_index("ix_announcements_published_at", "announcements", ["published_at"])
    op.create_index("ix_announcements_org_id", "announcements", ["org_id"])
    op.create_index("ix_announcements_author_id", "announcements", ["author_id"])
    op.create_index(
        "ix_announcements_org_published",
        "announcements",
        ["org_id", "is_published", "published_at"],
    )

    # 5. 建立 announcement_media 表
    op.create_table(
        "announcement_media",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("announcement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("storage_key", sa.String(500), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["announcement_id"], ["announcements.id"], ondelete="CASCADE"
        ),
    )
    op.create_index(
        "ix_announcement_media_announcement_id",
        "announcement_media",
        ["announcement_id"],
    )


def downgrade() -> None:
    op.drop_table("announcement_media")
    op.drop_table("announcements")
    op.drop_index("ix_documents_visibility_level", table_name="documents")
    op.drop_column("documents", "visibility_level")
    op.drop_column("document_attachments", "display_name")
    op.execute("DROP TYPE IF EXISTS documentvisibility")
