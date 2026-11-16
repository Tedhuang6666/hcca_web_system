"""活動 Drive 同步與多法規資料夾。"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20261115160000"
down_revision = "20261114160000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "regulation_sync_sources",
        sa.Column("extra_folder_ids", postgresql.JSONB(), nullable=False, server_default="[]"),
    )
    op.create_table(
        "gallery_drive_sync",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("scope", sa.String(20), nullable=False, unique=True),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("config", postgresql.JSONB(), nullable=False),
        sa.Column("manifest", postgresql.JSONB(), nullable=False),
        sa.Column("last_report", postgresql.JSONB(), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True)),
        sa.Column("next_sync_at", sa.DateTime(timezone=True)),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("gallery_drive_sync")
    op.drop_column("regulation_sync_sources", "extra_folder_ids")
