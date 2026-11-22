"""先限制新寫入的應收款金額與治理案件狀態，不掃描既有資料。

Revision ID: 20261117040000
Revises: 20261117030000

既有資料必須先用 scripts/sql/phase1_check_invariants.sql 盤點並經人工處理；
完成後另以 scripts/sql/phase1_validate_constraints.sql 驗證，不在 upgrade 中自動驗證。
"""

from alembic import op

revision = "20261117040000"
down_revision = "20261117030000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE receivables ADD CONSTRAINT ck_receivables_amounts
        CHECK (amount >= 0 AND paid_amount >= 0 AND paid_amount <= amount
               AND refunded_amount >= 0 AND refunded_amount <= paid_amount) NOT VALID
    """)
    op.execute("""
        ALTER TABLE council_proposals ADD CONSTRAINT ck_council_proposals_status
        CHECK (status IN ('submitted', 'committee_review', 'scheduled', 'council_review',
                          'passed', 'rejected', 'withdrawn', 'published')) NOT VALID
    """)
    op.execute("""
        ALTER TABLE judicial_petitions ADD CONSTRAINT ck_judicial_petitions_status
        CHECK (status IN ('submitted', 'docketing_review', 'accepted', 'in_review',
                          'decided', 'dismissed', 'withdrawn', 'published')) NOT VALID
    """)
    op.execute("""
        ALTER TABLE workflow_instances ADD CONSTRAINT ck_workflow_instances_source_status
        CHECK (
            (source_type <> 'council_proposal' OR status IN
                ('submitted', 'committee_review', 'scheduled', 'council_review',
                 'passed', 'rejected', 'withdrawn', 'published'))
            AND
            (source_type <> 'judicial_petition' OR status IN
                ('submitted', 'docketing_review', 'accepted', 'in_review',
                 'decided', 'dismissed', 'withdrawn', 'published'))
        ) NOT VALID
    """)


def downgrade() -> None:
    op.drop_constraint("ck_workflow_instances_source_status", "workflow_instances", type_="check")
    op.drop_constraint("ck_judicial_petitions_status", "judicial_petitions", type_="check")
    op.drop_constraint("ck_council_proposals_status", "council_proposals", type_="check")
    op.drop_constraint("ck_receivables_amounts", "receivables", type_="check")
