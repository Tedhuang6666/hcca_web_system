"""補齊效能觀測查詢索引。

Revision ID: 20260817160000
Revises: daf7058e1335
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260817160000"
down_revision: str | Sequence[str] | None = "daf7058e1335"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_pagespeed_runs_url_strategy_tested_at",
        "pagespeed_runs",
        ["url", "strategy", "tested_at"],
    )
    op.create_index(
        "ix_pagespeed_audits_run_id",
        "pagespeed_audits",
        ["run_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_pagespeed_audits_run_id", table_name="pagespeed_audits")
    op.drop_index("ix_pagespeed_runs_url_strategy_tested_at", table_name="pagespeed_runs")
