"""add_judicial_zone

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-05-02

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4d5e6f7a8b9"
down_revision: str | Sequence[str] | None = "b3c4d5e6f7a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    status_enum = postgresql.ENUM("open", "closed", name="judicialcasestatus", create_type=False)
    doc_type_enum = postgresql.ENUM(
        "decision", "interpretation", "indictment",
        "judgment", "order", "other",
        name="judicialdocumenttype",
        create_type=False,
    )
    status_enum.create(op.get_bind(), checkfirst=True)
    doc_type_enum.create(op.get_bind(), checkfirst=True)

    # 建立資料表：judicial_cases
    op.create_table(
        "judicial_cases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("case_no", sa.String(length=60), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "status",
            status_enum,
            nullable=False,
            server_default="open",
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("case_no", name="uq_judicial_case_no"),
    )
    op.create_index("ix_judicial_cases_case_no", "judicial_cases", ["case_no"], unique=False)
    op.create_index("ix_judicial_cases_status", "judicial_cases", ["status"], unique=False)
    op.create_index("ix_judicial_cases_created_by", "judicial_cases", ["created_by"], unique=False)

    op.create_foreign_key(
        "fk_judicial_cases_created_by",
        "judicial_cases",
        "users",
        ["created_by"],
        ["id"],
        ondelete="RESTRICT",
    )

    # 建立資料表：judicial_documents
    op.create_table(
        "judicial_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "doc_type",
            doc_type_enum,
            nullable=False,
            server_default="decision",
        ),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("regulation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_judicial_documents_case_id", "judicial_documents", ["case_id"], unique=False)
    op.create_index("ix_judicial_documents_doc_type", "judicial_documents", ["doc_type"], unique=False)
    op.create_index("ix_judicial_documents_is_public", "judicial_documents", ["is_public"], unique=False)
    op.create_index("ix_judicial_documents_created_by", "judicial_documents", ["created_by"], unique=False)

    op.create_foreign_key(
        "fk_judicial_documents_case_id",
        "judicial_documents",
        "judicial_cases",
        ["case_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_table("judicial_documents")
    op.drop_table("judicial_cases")
    # 下降時可以選擇是否要刪除 Type，這裡建議也加上 checkfirst
    postgresql.ENUM(name="judicialdocumenttype").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="judicialcasestatus").drop(op.get_bind(), checkfirst=True)
