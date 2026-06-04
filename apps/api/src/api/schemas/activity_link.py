"""活動工作區與跨模組關聯 schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from api.models.activity_link import ActivityLinkKind


class ActivityLinkCreate(BaseModel):
    target_type: ActivityLinkKind
    target_id: uuid.UUID
    title: str = Field(..., min_length=1, max_length=240)
    href: str = Field(..., min_length=1, max_length=500)
    note: str | None = None
    meta: dict = Field(default_factory=dict)


class ActivityLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    activity_id: uuid.UUID
    target_type: ActivityLinkKind
    target_id: uuid.UUID
    title: str
    href: str
    note: str | None
    meta: dict
    created_by_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class ActivityLinkSuggestion(BaseModel):
    suggestion_id: str
    target_type: ActivityLinkKind
    target_id: uuid.UUID
    title: str
    href: str
    score: int
    reasons: list[str]
    meta: dict = Field(default_factory=dict)


class ActivityWorkspaceSection(BaseModel):
    key: str
    title: str
    count: int = 0
    items: list[ActivityLinkOut] = Field(default_factory=list)


class ActivityChecklistItem(BaseModel):
    key: str
    title: str
    status: str
    action: str


class ActivityWorkspaceOut(BaseModel):
    activity_id: uuid.UUID
    sections: list[ActivityWorkspaceSection]
    pending_items: list[dict]
    checklist: list[ActivityChecklistItem]
    suggestions: list[ActivityLinkSuggestion]


class ActivityClosingReportOut(BaseModel):
    activity_id: uuid.UUID
    linked_counts: dict[str, int]
    receivables: dict[str, int]
    tasks: dict[str, int]
    publications: dict[str, int]
    generated_at: datetime
