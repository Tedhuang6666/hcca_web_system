"""add task performance indexes

Revision ID: 20260701103000
Revises: 20260628100000
Create Date: 2026-07-01 10:30:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "20260701103000"
down_revision: str | Sequence[str] | None = "20260628100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_notifications_user_read", "notifications", ["user_id", "is_read"])
    op.create_index("ix_notifications_user_created", "notifications", ["user_id", "created_at"])
    op.create_index(
        "ix_document_approvals_status_approver",
        "document_approvals",
        ["status", "approver_id"],
    )
    op.create_index(
        "ix_document_approvals_status_delegate",
        "document_approvals",
        ["status", "delegate_id"],
    )
    op.create_index(
        "ix_work_items_assignee_open_active_due",
        "work_items",
        ["assigned_to_id", "status", "is_active", "due_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_work_items_assignee_open_active_due", table_name="work_items")
    op.drop_index("ix_document_approvals_status_delegate", table_name="document_approvals")
    op.drop_index("ix_document_approvals_status_approver", table_name="document_approvals")
    op.drop_index("ix_notifications_user_created", table_name="notifications")
    op.drop_index("ix_notifications_user_read", table_name="notifications")
