"""儀表板 widget 與聚合回應 schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

WidgetKey = Literal[
    "doc_draft",
    "doc_pending_my_approval",
    "meeting_upcoming",
    "regulation_review",
    "regulation_publish",
    "petition_assigned",
    "open_surveys",
    "today_meal",
    "announcements_recent",
    "class_order_collecting",
]

Severity = Literal["info", "warning", "critical"]
LayoutHint = Literal["student", "officer", "leader"]


class DashboardWidgetItem(BaseModel):
    """widget 內的單筆預覽項目（最多 5 筆）。"""

    model_config = ConfigDict(from_attributes=True)

    title: str
    subtitle: str | None = None
    href: str | None = None
    timestamp: datetime | None = None
    badge: str | None = None


class DashboardWidget(BaseModel):
    """單一 widget 的內容。"""

    model_config = ConfigDict(from_attributes=True)

    key: WidgetKey
    title: str
    summary: str | None = None
    count: int | None = None
    href: str | None = None
    severity: Severity = "info"
    wide: bool = False
    items: list[DashboardWidgetItem] = []


class DashboardResponse(BaseModel):
    """整個儀表板的聚合回應。"""

    model_config = ConfigDict(from_attributes=True)

    widgets: list[DashboardWidget]
    layout_hint: LayoutHint
