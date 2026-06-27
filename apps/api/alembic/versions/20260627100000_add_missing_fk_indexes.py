"""補缺少的 FK index：documents.updated_by、document_revisions.changed_by、
meetings.created_by、meeting_agenda_items.regulation_id

Revision ID: 20260627100000
Revises: 20260614140000
Create Date: 2026-06-27 10:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260627100000"
down_revision: str | Sequence[str] | None = "20260614140000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # CONCURRENTLY 不鎖表，但不能在 transaction 裡執行，需要 autocommit_block
    with op.get_context().autocommit_block():
        op.create_index(
            "ix_documents_updated_by",
            "documents",
            ["updated_by"],
            if_not_exists=True,
            postgresql_concurrently=True,
        )
        op.create_index(
            "ix_document_revisions_changed_by",
            "document_revisions",
            ["changed_by"],
            if_not_exists=True,
            postgresql_concurrently=True,
        )
        op.create_index(
            "ix_meetings_created_by",
            "meetings",
            ["created_by"],
            if_not_exists=True,
            postgresql_concurrently=True,
        )
        op.create_index(
            "ix_meeting_agenda_items_regulation_id",
            "meeting_agenda_items",
            ["regulation_id"],
            if_not_exists=True,
            postgresql_concurrently=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index(
            "ix_documents_updated_by", table_name="documents", if_exists=True,
            postgresql_concurrently=True,
        )
        op.drop_index(
            "ix_document_revisions_changed_by", table_name="document_revisions", if_exists=True,
            postgresql_concurrently=True,
        )
        op.drop_index(
            "ix_meetings_created_by", table_name="meetings", if_exists=True,
            postgresql_concurrently=True,
        )
        op.drop_index(
            "ix_meeting_agenda_items_regulation_id", table_name="meeting_agenda_items", if_exists=True,
            postgresql_concurrently=True,
        )
