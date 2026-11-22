"""治理全模組事件：種示範自動化規則（預設暫停，使用者自行啟用）。

Revises: 20260606emailplatform
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "20260606goveventrules"
down_revision: str | Sequence[str] | None = "20260606emailplatform"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NS = uuid.UUID("22222222-3333-4444-5555-666666666666")


def _uid(name: str) -> str:
    return str(uuid.uuid5(_NS, name))


# 跨模組示範規則（預設 paused）。觸發型別對應 governance_events 登錄表的 event_type。
_RULES = [
    (
        "公文核准 → 建立後續任務",
        "連動此公文的事情，在公文核准後自動開立後續處理任務。",
        "document.approved",
        {},
        [{"type": "create_task", "title": "公文核准後續：{title}"}],
    ),
    (
        "法規公布 → 安排宣導",
        "法規公布後，於連動事情建立宣導公告任務並通知管理員。",
        "regulation.published",
        {},
        [
            {"type": "create_task", "title": "撰寫法規宣導公告"},
            {"type": "notify_admins", "title": "法規已公布", "body": "{title}"},
        ],
    ),
    (
        "提案排入議程 → 準備上會資料",
        "議會提案排入議程後，自動建立準備任務。",
        "proposal.scheduled",
        {},
        [{"type": "create_task", "title": "準備提案上會資料：{title}"}],
    ),
    (
        "問卷結束 → 整理結果",
        "問卷結束後，於連動事情建立成果整理任務。",
        "survey.closed",
        {},
        [{"type": "create_task", "title": "整理問卷結果並撰寫摘要"}],
    ),
]


def upgrade() -> None:
    now = datetime.now(UTC)
    rules = sa.table(
        "automation_rules",
        sa.column("id", sa.dialects.postgresql.UUID(as_uuid=True)),
        sa.column("name", sa.String),
        sa.column("description", sa.String),
        sa.column("trigger_type", sa.String),
        sa.column("conditions", sa.dialects.postgresql.JSONB),
        sa.column("actions", sa.dialects.postgresql.JSONB),
        sa.column("status", sa.String),
        sa.column("trigger_count", sa.Integer),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(
        rules,
        [
            {
                "id": _uid(f"rule:{name}"),
                "name": name,
                "description": desc,
                "trigger_type": trigger,
                "conditions": conditions,
                "actions": actions,
                "status": "paused",
                "trigger_count": 0,
                "created_at": now,
                "updated_at": now,
            }
            for name, desc, trigger, conditions, actions in _RULES
        ],
    )


def downgrade() -> None:
    rule_ids = tuple(_uid(f"rule:{r[0]}") for r in _RULES)
    op.execute(
        sa.text("DELETE FROM automation_rules WHERE id IN :ids").bindparams(
            sa.bindparam("ids", value=rule_ids, expanding=True)
        )
    )
