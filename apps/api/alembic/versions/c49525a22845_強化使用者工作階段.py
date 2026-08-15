"""強化使用者工作階段

Revision ID: c49525a22845
Revises: 20260815110000
Create Date: 2026-08-15 18:00:19.141526

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c49525a22845"
down_revision: str | Sequence[str] | None = "20260815110000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 先以 nullable 加欄，回填 legacy session 後再套用 NOT NULL；避免既有登入紀錄
    # 在 deploy migration 時被迫刪除。refresh_jti_hash 保留舊 raw JTI，服務層會在
    # 第一次 legacy refresh 時轉成 v2 HMAC digest。
    op.add_column(
        "user_sessions", sa.Column("refresh_jti_hash", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "user_sessions", sa.Column("previous_refresh_jti_hash", sa.String(length=64), nullable=True)
    )
    op.add_column("user_sessions", sa.Column("auth_method", sa.String(length=32), nullable=True))
    op.add_column(
        "user_sessions", sa.Column("auth_time", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "user_sessions", sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "user_sessions", sa.Column("absolute_expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("user_sessions", sa.Column("revoked_reason", sa.String(length=64), nullable=True))
    op.execute(
        """
        UPDATE user_sessions
        SET refresh_jti_hash = refresh_token_jti,
            auth_method = 'legacy',
            auth_time = COALESCE(last_seen_at, created_at),
            rotated_at = COALESCE(last_seen_at, created_at),
            absolute_expires_at = expires_at
        """
    )
    op.alter_column("user_sessions", "refresh_jti_hash", nullable=False)
    op.alter_column("user_sessions", "auth_method", nullable=False)
    op.alter_column("user_sessions", "auth_time", nullable=False)
    op.alter_column("user_sessions", "rotated_at", nullable=False)
    op.alter_column("user_sessions", "absolute_expires_at", nullable=False)
    op.drop_index(op.f("ix_user_sessions_refresh_jti"), table_name="user_sessions")
    op.create_index(
        "ix_user_sessions_refresh_jti", "user_sessions", ["refresh_jti_hash"], unique=True
    )
    op.drop_column("user_sessions", "refresh_token_jti")


def downgrade() -> None:
    op.add_column(
        "user_sessions",
        sa.Column("refresh_token_jti", sa.VARCHAR(length=64), autoincrement=False, nullable=True),
    )
    op.execute("UPDATE user_sessions SET refresh_token_jti = refresh_jti_hash")
    op.alter_column("user_sessions", "refresh_token_jti", nullable=False)
    op.drop_index("ix_user_sessions_refresh_jti", table_name="user_sessions")
    op.create_index(
        op.f("ix_user_sessions_refresh_jti"), "user_sessions", ["refresh_token_jti"], unique=True
    )
    op.drop_column("user_sessions", "revoked_reason")
    op.drop_column("user_sessions", "absolute_expires_at")
    op.drop_column("user_sessions", "rotated_at")
    op.drop_column("user_sessions", "auth_time")
    op.drop_column("user_sessions", "auth_method")
    op.drop_column("user_sessions", "previous_refresh_jti_hash")
    op.drop_column("user_sessions", "refresh_jti_hash")
