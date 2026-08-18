"""新增現場抽獎系統。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "20260818120000"
down_revision: str | Sequence[str] | None = "20260817160000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "raffle_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_code", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("access_code_hash", sa.String(length=64), nullable=False),
        sa.Column("access_code_hint", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("draw_count", sa.Integer(), nullable=False),
        sa.Column("reserve_released", sa.Boolean(), nullable=False),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_code", name="uq_raffle_events_event_code"),
    )
    op.create_index("ix_raffle_events_event_code", "raffle_events", ["event_code"])
    op.create_index("ix_raffle_events_status", "raffle_events", ["status"])
    op.create_table(
        "raffle_prizes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tier", sa.String(length=2), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("total_quantity", sa.Integer(), nullable=True),
        sa.Column("remaining_quantity", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["raffle_events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_raffle_prizes_event_id", "raffle_prizes", ["event_id"])
    op.create_index("ix_raffle_prizes_event_tier", "raffle_prizes", ["event_id", "tier"])
    op.create_table(
        "raffle_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("device_id", sa.String(length=120), nullable=True),
        sa.Column("has_drawn", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["raffle_events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "token_hash", name="uq_raffle_sessions_token"),
    )
    op.create_index("ix_raffle_sessions_event_id", "raffle_sessions", ["event_id"])
    op.create_table(
        "raffle_draws",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("prize_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("draw_number", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["raffle_events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["prize_id"], ["raffle_prizes.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["session_id"], ["raffle_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "session_id", name="uq_raffle_draws_session"),
        sa.UniqueConstraint("event_id", "idempotency_key", name="uq_raffle_draws_idempotency"),
        sa.UniqueConstraint("event_id", "draw_number", name="uq_raffle_draws_number"),
    )
    op.create_index("ix_raffle_draws_event_id", "raffle_draws", ["event_id"])
    op.create_index("ix_raffle_draws_session_id", "raffle_draws", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_raffle_draws_session_id", table_name="raffle_draws")
    op.drop_index("ix_raffle_draws_event_id", table_name="raffle_draws")
    op.drop_table("raffle_draws")
    op.drop_index("ix_raffle_sessions_event_id", table_name="raffle_sessions")
    op.drop_table("raffle_sessions")
    op.drop_index("ix_raffle_prizes_event_tier", table_name="raffle_prizes")
    op.drop_index("ix_raffle_prizes_event_id", table_name="raffle_prizes")
    op.drop_table("raffle_prizes")
    op.drop_index("ix_raffle_events_status", table_name="raffle_events")
    op.drop_index("ix_raffle_events_event_code", table_name="raffle_events")
    op.drop_table("raffle_events")
