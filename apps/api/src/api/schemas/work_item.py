"""工作分配與期限提醒 schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from api.models.work_item import WorkItemStatus


class WorkItemCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=5000)
    assigned_to_id: uuid.UUID | None = None
    source_type: str | None = Field(None, max_length=50)
    source_id: uuid.UUID | None = None
    due_at: datetime | None = None


class WorkItemUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=5000)
    assigned_to_id: uuid.UUID | None = None
    due_at: datetime | None = None
    status: WorkItemStatus | None = None


class WorkItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None
    status: WorkItemStatus
    assigned_to_id: uuid.UUID | None
    created_by_id: uuid.UUID | None
    source_type: str | None
    source_id: uuid.UUID | None
    due_at: datetime | None
    reminder_sent_at: datetime | None
    completed_at: datetime | None
    discord_channel_id: str | None
    discord_message_id: str | None
    google_task_id: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
