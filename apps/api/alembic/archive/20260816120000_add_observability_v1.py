"""add observability v1 tables"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260816120000"
down_revision = "20260815150000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "observability_releases",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("release", sa.String(128), nullable=False, unique=True),
        sa.Column("commit_sha", sa.String(64), nullable=False),
        sa.Column("environment", sa.String(32), nullable=False),
        sa.Column("deployed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_observability_releases_commit_sha", "observability_releases", ["commit_sha"]
    )
    op.create_table(
        "pagespeed_runs",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("strategy", sa.String(16), nullable=False),
        sa.Column("tested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "release_id", uuid, sa.ForeignKey("observability_releases.id", ondelete="SET NULL")
        ),
        sa.Column("performance_score", sa.Float()),
        sa.Column("lcp_ms", sa.Float()),
        sa.Column("tbt_ms", sa.Float()),
        sa.Column("cls", sa.Float()),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("error_message", sa.Text()),
    )
    op.create_table(
        "pagespeed_audits",
        sa.Column("id", uuid, primary_key=True),
        sa.Column(
            "run_id", uuid, sa.ForeignKey("pagespeed_runs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("audit_id", sa.String(128), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("score", sa.Float()),
        sa.Column("numeric_value", sa.Float()),
        sa.Column("display_value", sa.Text()),
    )
    op.create_table(
        "crux_snapshots",
        sa.Column("id", uuid, primary_key=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("form_factor", sa.String(16), nullable=False),
        sa.Column("collected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lcp_p75", sa.Float()),
        sa.Column("inp_p75", sa.Float()),
        sa.Column("cls_p75", sa.Float()),
        sa.Column("ttfb_p75", sa.Float()),
    )


def downgrade() -> None:
    op.drop_table("crux_snapshots")
    op.drop_table("pagespeed_audits")
    op.drop_table("pagespeed_runs")
    op.drop_index("ix_observability_releases_commit_sha", table_name="observability_releases")
    op.drop_table("observability_releases")
