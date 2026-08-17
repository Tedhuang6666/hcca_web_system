"""add observability query indexes

Revision ID: 0676096e8187
Revises: 20260817160000
Create Date: 2026-08-18 02:02:20.394974

"""

from collections.abc import Sequence

from alembic import op

revision: str = "0676096e8187"
down_revision: str | Sequence[str] | None = "20260817160000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(
        "ix_pagespeed_runs_url_strategy_tested_at",
        "pagespeed_runs",
        ["url", "strategy", "tested_at"],
    )
    op.create_index("ix_pagespeed_audits_run_id", "pagespeed_audits", ["run_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_pagespeed_audits_run_id", table_name="pagespeed_audits")
    op.drop_index("ix_pagespeed_runs_url_strategy_tested_at", table_name="pagespeed_runs")
