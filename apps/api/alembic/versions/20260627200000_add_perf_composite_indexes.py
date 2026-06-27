"""效能複合索引：delegation lookup、recipients doc+type、regulation freeze_document_id

Revision ID: 20260627200000
Revises: 20260627100000
Create Date: 2026-06-27 20:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260627200000"
down_revision: str | Sequence[str] | None = "20260627100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        # 代理授權查詢：principal_user_id + org_id + is_active + start_at
        op.create_index(
            "ix_doc_approval_delegation_lookup",
            "document_approval_delegations",
            ["principal_user_id", "org_id", "is_active", "start_at"],
            if_not_exists=True,
            postgresql_concurrently=True,
        )
        # 受文者清單：document_id + recipient_type
        op.create_index(
            "ix_document_recipients_doc_type",
            "document_recipients",
            ["document_id", "recipient_type"],
            if_not_exists=True,
            postgresql_concurrently=True,
        )
        # 法規凍結依據公文 FK
        op.create_index(
            "ix_regulations_freeze_document_id",
            "regulations",
            ["freeze_document_id"],
            if_not_exists=True,
            postgresql_concurrently=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index(
            "ix_doc_approval_delegation_lookup",
            table_name="document_approval_delegations",
            if_exists=True,
            postgresql_concurrently=True,
        )
        op.drop_index(
            "ix_document_recipients_doc_type",
            table_name="document_recipients",
            if_exists=True,
            postgresql_concurrently=True,
        )
        op.drop_index(
            "ix_regulations_freeze_document_id",
            table_name="regulations",
            if_exists=True,
            postgresql_concurrently=True,
        )
