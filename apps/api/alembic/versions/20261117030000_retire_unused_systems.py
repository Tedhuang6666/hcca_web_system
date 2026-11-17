"""移除已退役的活動工作區、庫存、客服、銀行交易與治理管理資料結構。

Revision ID: 20261117030000
Revises: 20261117020000

這些表的資料無法由 schema 重建，正式套用前須另行核准與備份。
既有活動授權、工作流、治理事件與歷史應收款資料保留。
"""

from alembic import op

revision = "20261117030000"
down_revision = "20261117020000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL 會一併移除本欄位的外鍵與索引，保留原案件本身。
    op.drop_column("governance_cases", "program_id")
    # 不使用 CASCADE；未知的跨表相依應使交易停止，避免連帶刪除現行資料。
    for name in (
        "planning_document_revision_attachments",
        "planning_document_revisions",
        "planning_document_attachments",
        "planning_documents",
        "finance_bank_transactions",
        "inventory_transactions",
        "inventory_procurement_items",
        "activity_members",
        "programs",
        "matter_role_assignments",
        "inventory_items",
        "discord_activity_workspaces",
        "activity_roles",
        "activity_links",
        "support_ticket_events",
        "support_impersonation_sessions",
        "support_audit_logs",
        "support_assistance_sessions",
        "support_approvals",
        "inventory_procurements",
        "inventory_categories",
        "support_tickets",
        "support_guide_entries",
        "governance_workflow_templates",
    ):
        op.drop_table(name)


def downgrade() -> None:
    raise RuntimeError("退役資料已移除；請以升級前備份復原，不可建立空表冒充資料復原。")
