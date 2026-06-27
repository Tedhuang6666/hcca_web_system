"""效能複合索引：audit_logs(actor_email, created_at)、email_messages(created_at, status)、person_affiliations(person_id, kind, status)

Revision ID: 20260628100000
Revises: 20260627200000
Create Date: 2026-06-28 10:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260628100000"
down_revision: str | Sequence[str] | None = "20260627200000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        # 稽核紀錄：依操作者 email 加日期範圍查詢（稽核報表篩選用）
        op.create_index(
            "ix_audit_logs_actor_email_created_at",
            "audit_logs",
            ["actor_email", "created_at"],
            if_not_exists=True,
            postgresql_concurrently=True,
        )
        # 郵件列表：管理頁依建立時間排序加狀態篩選
        op.create_index(
            "ix_email_messages_created_at_status",
            "email_messages",
            ["created_at", "status"],
            if_not_exists=True,
            postgresql_concurrently=True,
        )
        # 人員任職：affiliation_to_out() 最常見的三欄複合篩選
        op.create_index(
            "ix_person_affiliations_person_kind_status",
            "person_affiliations",
            ["person_id", "kind", "status"],
            if_not_exists=True,
            postgresql_concurrently=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index(
            "ix_audit_logs_actor_email_created_at",
            table_name="audit_logs",
            if_exists=True,
            postgresql_concurrently=True,
        )
        op.drop_index(
            "ix_email_messages_created_at_status",
            table_name="email_messages",
            if_exists=True,
            postgresql_concurrently=True,
        )
        op.drop_index(
            "ix_person_affiliations_person_kind_status",
            table_name="person_affiliations",
            if_exists=True,
            postgresql_concurrently=True,
        )
