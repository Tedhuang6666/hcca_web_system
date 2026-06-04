"""待辦中心 schema：跨模組 TaskItem。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

TaskModule = Literal[
    "document",
    "meeting",
    "regulation",
    "petition",
    "meal",
    "shop",
    "survey",
    "announcement",
    "calendar",
    "work_item",
]

TaskAction = Literal[
    "approve",
    "attend",
    "review",
    "publish",
    "reply",
    "fill",
    "collect",
    "pickup",
    "sign",
    "complete",
    "prepare",
    "manage",
]

TaskSeverity = Literal["info", "warning", "critical"]


class TaskItem(BaseModel):
    """單一待辦項目。id 形式：{module}:{entity_id}:{action}（前端可去重）。"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    module: TaskModule
    action: TaskAction
    title: str
    subtitle: str | None = None
    href: str
    due_at: datetime | None = None
    severity: TaskSeverity = "info"
    created_at: datetime
    priority_score: int = 0
    priority_reasons: list[str] = Field(default_factory=list)
    recommended_action: str | None = None


class TaskInboxResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    items: list[TaskItem]
    total: int
    by_module: dict[str, int]
