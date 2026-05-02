"""p4_serial_templates_regulation_articles

新增 document_serial_templates（字號模板）、
regulation_revisions（修訂歷程）、
regulation_articles（結構化條文）資料表，
並更新 regulations.category enum 與 documents.serial_template_id 外鍵。

Revision ID: a1b2c3d4e5f6
Revises: 800f057f0482
Create Date: 2026-04-13 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "800f057f0482"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. 新增 Enum 型別 ─────────────────────────────────────────────────────
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'yearmode') THEN
                CREATE TYPE yearmode AS ENUM ('roc', 'ce');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'articletype') THEN
                CREATE TYPE articletype AS ENUM (
                    'volume', 'chapter', 'section', 'subsection', 'clause', 'special_clause'
                );
            END IF;
        END $$;
    """)

    # ── 2. 更新 regulationcategory Enum（新增多個值）──────────────────────────
    # PostgreSQL 允許 ALTER TYPE ... ADD VALUE （不可移除舊值）
    op.execute("""
        DO $$ BEGIN
            -- 新增類別（若已存在則略過）
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum
                WHERE enumlabel = 'constitution'
                AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'regulationcategory')
            ) THEN
                ALTER TYPE regulationcategory ADD VALUE 'constitution';
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum
                WHERE enumlabel = 'chairman'
                AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'regulationcategory')
            ) THEN
                ALTER TYPE regulationcategory ADD VALUE 'chairman';
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum
                WHERE enumlabel = 'executive_dept'
                AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'regulationcategory')
            ) THEN
                ALTER TYPE regulationcategory ADD VALUE 'executive_dept';
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum
                WHERE enumlabel = 'student_council'
                AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'regulationcategory')
            ) THEN
                ALTER TYPE regulationcategory ADD VALUE 'student_council';
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum
                WHERE enumlabel = 'judicial_committee'
                AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'regulationcategory')
            ) THEN
                ALTER TYPE regulationcategory ADD VALUE 'judicial_committee';
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum
                WHERE enumlabel = 'executive_order'
                AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'regulationcategory')
            ) THEN
                ALTER TYPE regulationcategory ADD VALUE 'executive_order';
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum
                WHERE enumlabel = 'council_order'
                AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'regulationcategory')
            ) THEN
                ALTER TYPE regulationcategory ADD VALUE 'council_order';
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum
                WHERE enumlabel = 'judicial_order'
                AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'regulationcategory')
            ) THEN
                ALTER TYPE regulationcategory ADD VALUE 'judicial_order';
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_enum
                WHERE enumlabel = 'election_order'
                AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'regulationcategory')
            ) THEN
                ALTER TYPE regulationcategory ADD VALUE 'election_order';
            END IF;
        END $$;
    """)

    # ── 3. 建立 document_serial_templates ─────────────────────────────────────
    op.create_table(
        "document_serial_templates",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("org_prefix", sa.String(length=20), nullable=False),
        sa.Column("category_char", sa.String(length=10), nullable=False),
        sa.Column(
            "year_mode",
            postgresql.ENUM("roc", "ce", name="yearmode", create_type=False),
            nullable=False,
        ),
        sa.Column("reset_on_new_year", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("current_year", sa.Integer(), nullable=False),
        sa.Column("counter", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("description", sa.String(length=200), nullable=True),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["orgs.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", "org_prefix", "category_char", name="uq_serial_template"),
    )
    op.create_index("ix_document_serial_templates_org_id", "document_serial_templates", ["org_id"])
    op.create_index("ix_document_serial_templates_is_active", "document_serial_templates", ["is_active"])

    # ── 4. 在 documents 新增 serial_template_id FK ────────────────────────────
    op.add_column("documents", sa.Column("serial_template_id", sa.UUID(), nullable=True))
    op.create_index("ix_documents_serial_template_id", "documents", ["serial_template_id"])
    op.create_foreign_key(
        "fk_documents_serial_template_id",
        "documents", "document_serial_templates",
        ["serial_template_id"], ["id"], ondelete="RESTRICT",
    )

    # ── 5. 在 regulations 新增 preface 欄位 ───────────────────────────────────
    op.add_column("regulations", sa.Column("preface", sa.Text(), nullable=True))

    # ── 6. 建立 regulation_revisions ──────────────────────────────────────────
    op.create_table(
        "regulation_revisions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("regulation_id", sa.UUID(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("change_brief", sa.String(length=500), nullable=False),
        sa.Column("is_total_amendment", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("content_snapshot", sa.Text(), nullable=False, server_default=""),
        sa.Column("resolution_link", sa.Text(), nullable=True),
        sa.Column("amended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("amended_by", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["regulation_id"], ["regulations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["amended_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_regulation_revisions_regulation_id", "regulation_revisions", ["regulation_id"])

    # ── 7. 建立 regulation_articles ───────────────────────────────────────────
    op.create_table(
        "regulation_articles",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("regulation_id", sa.UUID(), nullable=False),
        sa.Column("sort_index", sa.Integer(), nullable=False),
        sa.Column(
            "article_type",
            postgresql.ENUM(
                "volume", "chapter", "section", "subsection", "clause", "special_clause",
                name="articletype", create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("subtitle", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("frozen_by", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["regulation_id"], ["regulations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_regulation_articles_regulation_id", "regulation_articles", ["regulation_id"])


def downgrade() -> None:
    # 反向移除（按建立順序逆序）
    op.drop_index("ix_regulation_articles_regulation_id", table_name="regulation_articles")
    op.drop_table("regulation_articles")

    op.drop_index("ix_regulation_revisions_regulation_id", table_name="regulation_revisions")
    op.drop_table("regulation_revisions")

    op.drop_column("regulations", "preface")

    op.drop_constraint("fk_documents_serial_template_id", "documents", type_="foreignkey")
    op.drop_index("ix_documents_serial_template_id", table_name="documents")
    op.drop_column("documents", "serial_template_id")

    op.drop_index("ix_document_serial_templates_is_active", table_name="document_serial_templates")
    op.drop_index("ix_document_serial_templates_org_id", table_name="document_serial_templates")
    op.drop_table("document_serial_templates")

    op.execute("DROP TYPE IF EXISTS articletype")
    op.execute("DROP TYPE IF EXISTS yearmode")
