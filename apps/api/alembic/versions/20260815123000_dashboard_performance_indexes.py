"""儀表板與待辦查詢索引

Revision ID: 20260815123000
Revises: c49525a22845
Create Date: 2026-08-15 12:30:00.000000
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260815123000"
down_revision: str | Sequence[str] | None = "c49525a22845"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Enum 欄位以 StrEnum value（小寫）儲存。時間條件留給查詢本身，避免
    # CURRENT_DATE / NOW() 出現在 partial index predicate（PostgreSQL 不接受）。
    op.execute(
        """
        CREATE INDEX ix_doc_approvals_pending_approver
        ON document_approvals (status, approver_id)
        WHERE status = 'pending'
        """
    )
    op.execute(
        """
        CREATE INDEX ix_meetings_upcoming
        ON meetings (starts_at, status)
        WHERE status IN ('draft', 'active', 'paused')
        """
    )
    op.execute(
        """
        CREATE INDEX ix_regulations_workflow_pub
        ON regulations (workflow_status, updated_at DESC)
        WHERE workflow_status IN ('under_review', 'scheduled', 'council_approved')
        """
    )
    op.execute(
        """
        CREATE INDEX ix_petitions_assigned_status
        ON petition_cases (assigned_to_id, status)
        WHERE status IN ('submitted', 'in_progress', 'needs_info')
        """
    )
    op.execute(
        """
        CREATE INDEX ix_surveys_open
        ON surveys (status, updated_at DESC)
        WHERE status = 'open'
        """
    )
    op.execute(
        """
        CREATE INDEX ix_calendar_checklist_assignee_due
        ON calendar_event_checklist_items (assignee_id, is_done, due_at)
        WHERE is_done = FALSE
        """
    )
    op.execute(
        """
        CREATE INDEX ix_work_items_assigned_open
        ON work_items (assigned_to_id, status, is_active)
        WHERE status = 'open' AND is_active = TRUE
        """
    )
    op.create_index(
        "ix_user_positions_user_tenure_position",
        "user_positions",
        ["user_id", "start_date", "end_date", "position_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_positions_user_tenure_position", table_name="user_positions")
    for name, table in (
        ("ix_work_items_assigned_open", "work_items"),
        ("ix_calendar_checklist_assignee_due", "calendar_event_checklist_items"),
        ("ix_surveys_open", "surveys"),
        ("ix_petitions_assigned_status", "petition_cases"),
        ("ix_regulations_workflow_pub", "regulations"),
        ("ix_meetings_upcoming", "meetings"),
        ("ix_doc_approvals_pending_approver", "document_approvals"),
    ):
        op.drop_index(name, table_name=table)
