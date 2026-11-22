"""建立預約寄信的管理開關。

Revision ID: 202607220003
Revises: 202607220002
Create Date: 2026-07-22 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607220003"
down_revision: str | Sequence[str] | None = "202607220002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO feature_flags (
                id,
                key,
                description,
                is_globally_enabled,
                percentage_rollout,
                enabled_user_ids,
                enabled_permission_codes
            )
            VALUES (
                gen_random_uuid(),
                'email_scheduled_dispatch',
                '每 60 秒處理到期的預約郵件',
                true,
                0,
                '[]'::jsonb,
                '[]'::jsonb
            )
            ON CONFLICT (key) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO feature_flags (
                id,
                key,
                description,
                is_globally_enabled,
                percentage_rollout,
                enabled_user_ids,
                enabled_permission_codes
            )
            VALUES (
                gen_random_uuid(),
                'email_error_report',
                '寄送 API 與 Celery 錯誤通報信',
                true,
                0,
                '[]'::jsonb,
                '[]'::jsonb
            )
            ON CONFLICT (key) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DELETE FROM feature_flags WHERE key IN "
            "('email_scheduled_dispatch', 'email_error_report')"
        )
    )
