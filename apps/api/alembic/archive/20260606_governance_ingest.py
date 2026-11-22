"""治理中樞事件匯流與自動化引擎：automation_rules 觀測欄位 + 種子模板/規則。

Revises: 20260605election
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "20260606govingest"
down_revision: str | Sequence[str] | None = "20260605election"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 種子資料用固定命名空間，downgrade 時可精準刪除。
_NS = uuid.UUID("11111111-2222-3333-4444-555555555555")

# 20260604_governance_hub 建表時 created_at/updated_at 設成 NOT NULL 卻漏了 DB 層
# server_default now()，導致經 API 建立 Matter/Case/Decision 會 NotNullViolation 500。
# ORM 端雖宣告 server_default=func.now() 但未落到 DB。這裡補上預設值修掉這個潛在 bug。
_TIMESTAMP_TABLES = [
    "matters",
    "programs",
    "governance_cases",
    "entity_relations",
    "decisions",
    "planning_documents",
    "planning_document_revisions",
    "matter_role_assignments",
    "governance_workflow_templates",
    "automation_rules",
]


def _uid(name: str) -> str:
    return str(uuid.uuid5(_NS, name))


# 流程模板（被動資料，預設啟用）——對應規劃書 §四 Workflow Template。
_TEMPLATES = [
    (
        "活動流程",
        "activity",
        "從構想到歸檔的完整活動生命週期",
        [
            {"key": "idea", "label": "構想"},
            {"key": "plan", "label": "企劃"},
            {"key": "review", "label": "審議"},
            {"key": "approve", "label": "核准"},
            {"key": "organize", "label": "組織建立"},
            {"key": "execute", "label": "執行"},
            {"key": "report", "label": "成果報告"},
            {"key": "archive", "label": "歸檔"},
        ],
    ),
    (
        "法規修正流程",
        "regulation",
        "法規草案到公布的審議流程",
        [
            {"key": "draft", "label": "提出草案"},
            {"key": "agenda", "label": "排入議程"},
            {"key": "deliberate", "label": "會議審議"},
            {"key": "revise", "label": "修正"},
            {"key": "approve", "label": "議會核定"},
            {"key": "publish", "label": "公布施行"},
        ],
    ),
    (
        "陳情處理流程",
        "petition",
        "陳情自收件到結案",
        [
            {"key": "received", "label": "收件"},
            {"key": "assign", "label": "分派承辦"},
            {"key": "process", "label": "處理中"},
            {"key": "reply", "label": "回覆"},
            {"key": "close", "label": "結案"},
        ],
    ),
    (
        "評議審查流程",
        "judicial",
        "評議委員會審查",
        [
            {"key": "submit", "label": "提出"},
            {"key": "accept", "label": "受理"},
            {"key": "review", "label": "審查"},
            {"key": "decide", "label": "決議"},
            {"key": "archive", "label": "歸檔"},
        ],
    ),
    (
        "採購流程",
        "procurement",
        "設備/廠商採購",
        [
            {"key": "request", "label": "需求提出"},
            {"key": "quote", "label": "詢價比價"},
            {"key": "approve", "label": "核准"},
            {"key": "order", "label": "下單"},
            {"key": "accept", "label": "驗收"},
        ],
    ),
]

# 示範自動化規則（預設「暫停」，使用者確認後再啟用，避免突如其來的副作用）。
_RULES = [
    (
        "陳情建立 → 開立治理事項並指派任務",
        "陳情送件後自動建立一件事情、開立處理案件、產生待辦並通知管理員。",
        "petition.created",
        {},
        [
            {"type": "create_matter", "title": "陳情處理：{title}", "matter_type": "petition"},
            {"type": "create_case", "title": "受理與分派", "case_type": "petition"},
            {"type": "create_task", "title": "指派承辦並於期限內回覆"},
            {"type": "notify_admins", "title": "新陳情待處理", "body": "{title}"},
        ],
    ),
    (
        "會議通過 → 提醒落實決議",
        "會議產生決議時，於連動事情建立追蹤任務並通知。",
        "meeting.decision_created",
        {"status": "passed"},
        [
            {"type": "create_task", "title": "落實決議：{title}"},
            {"type": "notify_admins", "title": "決議待執行", "body": "{title}"},
        ],
    ),
    (
        "活動結束 → 建立成果與檢討",
        "活動標記結束後，自動建立成果報告任務與檢討問卷任務。",
        "activity.completed",
        {},
        [
            {"type": "create_task", "title": "撰寫成果報告"},
            {"type": "create_task", "title": "建立檢討會議與問卷"},
        ],
    ),
]


def upgrade() -> None:
    # 修正治理表缺少的 created_at/updated_at DB 預設值（見上方說明）。
    for table in _TIMESTAMP_TABLES:
        op.execute(f"ALTER TABLE {table} ALTER COLUMN created_at SET DEFAULT now()")
        op.execute(f"ALTER TABLE {table} ALTER COLUMN updated_at SET DEFAULT now()")

    op.add_column(
        "automation_rules",
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "automation_rules",
        sa.Column(
            "trigger_count", sa.Integer(), nullable=False, server_default="0"
        ),
    )

    now = datetime.now(UTC)

    templates = sa.table(
        "governance_workflow_templates",
        sa.column("id", sa.dialects.postgresql.UUID(as_uuid=True)),
        sa.column("name", sa.String),
        sa.column("template_type", sa.String),
        sa.column("description", sa.String),
        sa.column("version", sa.Integer),
        sa.column("steps", sa.dialects.postgresql.JSONB),
        sa.column("is_active", sa.Boolean),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(
        templates,
        [
            {
                "id": _uid(f"template:{name}"),
                "name": name,
                "template_type": ttype,
                "description": desc,
                "version": 1,
                "steps": steps,
                "is_active": True,
                "created_at": now,
                "updated_at": now,
            }
            for name, ttype, desc, steps in _TEMPLATES
        ],
    )

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
    template_ids = tuple(_uid(f"template:{t[0]}") for t in _TEMPLATES)
    op.execute(
        sa.text("DELETE FROM automation_rules WHERE id IN :ids").bindparams(
            sa.bindparam("ids", value=rule_ids, expanding=True)
        )
    )
    op.execute(
        sa.text(
            "DELETE FROM governance_workflow_templates WHERE id IN :ids"
        ).bindparams(sa.bindparam("ids", value=template_ids, expanding=True))
    )
    op.drop_column("automation_rules", "trigger_count")
    op.drop_column("automation_rules", "last_triggered_at")

    for table in _TIMESTAMP_TABLES:
        op.execute(f"ALTER TABLE {table} ALTER COLUMN created_at DROP DEFAULT")
        op.execute(f"ALTER TABLE {table} ALTER COLUMN updated_at DROP DEFAULT")
