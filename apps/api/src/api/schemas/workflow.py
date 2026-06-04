"""跨模組工作流 schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WorkflowTransitionCreate(BaseModel):
    status: str = Field(..., min_length=1, max_length=50)
    note: str | None = Field(None, max_length=5000)
    payload: dict = Field(default_factory=dict)


class WorkflowLinkCreate(BaseModel):
    target_type: str = Field(..., min_length=1, max_length=50)
    target_id: uuid.UUID | None = None
    relation: str = Field("related", min_length=1, max_length=50)
    title: str = Field(..., min_length=1, max_length=240)
    href: str | None = Field(None, max_length=500)
    note: str | None = Field(None, max_length=5000)
    meta: dict = Field(default_factory=dict)


class WorkflowLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    instance_id: uuid.UUID
    target_type: str
    target_id: uuid.UUID | None
    relation: str
    title: str
    href: str | None
    note: str | None
    meta: dict
    created_by_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class WorkflowEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    instance_id: uuid.UUID
    event_type: str
    from_status: str | None
    to_status: str | None
    actor_id: uuid.UUID | None
    actor_email: str | None
    note: str | None
    payload: dict
    created_at: datetime


class WorkflowInstanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workflow_type: str
    source_type: str
    source_id: uuid.UUID
    title: str
    status: str
    current_step: str | None
    org_id: uuid.UUID | None
    activity_id: uuid.UUID | None
    created_by_id: uuid.UUID | None
    completed_at: datetime | None
    is_active: bool
    meta: dict
    created_at: datetime
    updated_at: datetime
    links: list[WorkflowLinkOut] = []


class WorkflowTimelineOut(BaseModel):
    instance: WorkflowInstanceOut
    events: list[WorkflowEventOut]
    links: list[WorkflowLinkOut]
