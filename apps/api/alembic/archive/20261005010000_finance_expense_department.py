"""Store the department on each budget expense."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261005010000"
down_revision: str | Sequence[str] | None = "20261005000000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "finance_budget_expenses",
        sa.Column("department_org_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_finance_budget_expenses_department_org_id_orgs",
        "finance_budget_expenses",
        "orgs",
        ["department_org_id"],
        ["id"],
    )
    op.execute(
        sa.text(
            "UPDATE finance_budget_expenses AS expense "
            "SET department_org_id = allocation.proposing_org_id "
            "FROM finance_budget_allocations AS allocation "
            "WHERE allocation.id = expense.allocation_id"
        )
    )
    op.alter_column(
        "finance_budget_expenses",
        "department_org_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_finance_budget_expenses_department_org_id_orgs",
        "finance_budget_expenses",
        type_="foreignkey",
    )
    op.drop_column("finance_budget_expenses", "department_org_id")
