"""行事曆 Pydantic schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.networks import HttpUrl

from api.models.calendar import (
    CalendarEventStatus,
    CalendarEventType,
    CalendarLinkType,
    CalendarParticipantResponse,
    CalendarParticipantRole,
    CalendarVisibility,
)


class CalendarUserBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    email: str
    student_id: str | None = None


class CalendarParticipantCreate(BaseModel):
    user_id: uuid.UUID
    role: CalendarParticipantRole = CalendarParticipantRole.REQUIRED
    response: CalendarParticipantResponse = CalendarParticipantResponse.PENDING


class CalendarParticipantUpdate(BaseModel):
    role: CalendarParticipantRole | None = None
    response: CalendarParticipantResponse | None = None


class CalendarParticipantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_id: uuid.UUID
    user_id: uuid.UUID
    role: CalendarParticipantRole
    response: CalendarParticipantResponse
    created_at: datetime
    updated_at: datetime
    user: CalendarUserBrief | None = None


class CalendarChecklistCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    due_at: datetime | None = None
    assignee_id: uuid.UUID | None = None


class CalendarChecklistUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    due_at: datetime | None = None
    assignee_id: uuid.UUID | None = None
    is_done: bool | None = None


class CalendarChecklistOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_id: uuid.UUID
    title: str
    due_at: datetime | None
    assignee_id: uuid.UUID | None
    is_done: bool
    done_at: datetime | None
    created_at: datetime
    updated_at: datetime
    assignee: CalendarUserBrief | None = None


class CalendarLinkCreate(BaseModel):
    link_type: CalendarLinkType
    object_id: uuid.UUID | None = None
    title: str = Field(..., min_length=1, max_length=200)
    url: HttpUrl | None = None


class CalendarLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_id: uuid.UUID
    link_type: CalendarLinkType
    object_id: uuid.UUID | None
    title: str
    url: str | None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime


class CalendarEventCreate(BaseModel):
    org_id: uuid.UUID
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    event_type: CalendarEventType = CalendarEventType.ACTIVITY
    status: CalendarEventStatus = CalendarEventStatus.CONFIRMED
    visibility: CalendarVisibility = CalendarVisibility.ORG
    location: str | None = Field(None, max_length=200)
    starts_at: datetime
    ends_at: datetime | None = None
    all_day: bool = False
    participants: list[CalendarParticipantCreate] = []
    checklist_items: list[CalendarChecklistCreate] = []
    links: list[CalendarLinkCreate] = []

    @model_validator(mode="after")
    def validate_range(self) -> CalendarEventCreate:
        if self.ends_at is not None and self.ends_at < self.starts_at:
            raise ValueError("結束時間不可早於開始時間")
        return self


class CalendarEventUpdate(BaseModel):
    org_id: uuid.UUID | None = None
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    event_type: CalendarEventType | None = None
    status: CalendarEventStatus | None = None
    visibility: CalendarVisibility | None = None
    location: str | None = Field(None, max_length=200)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    all_day: bool | None = None

    @model_validator(mode="after")
    def validate_range(self) -> CalendarEventUpdate:
        if (
            self.starts_at is not None
            and self.ends_at is not None
            and self.ends_at < self.starts_at
        ):
            raise ValueError("結束時間不可早於開始時間")
        return self


class CalendarEventListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID | None
    title: str
    description: str | None
    event_type: CalendarEventType
    status: CalendarEventStatus
    visibility: CalendarVisibility
    location: str | None
    starts_at: datetime
    ends_at: datetime | None
    all_day: bool
    source_meeting_id: uuid.UUID | None
    source_module: str | None = None
    source_id: uuid.UUID | None = None
    source_key: str | None = None
    href: str | None = None
    created_by: uuid.UUID
    updated_by: uuid.UUID | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CalendarEventOut(CalendarEventListItem):
    participants: list[CalendarParticipantOut] = []
    checklist_items: list[CalendarChecklistOut] = []
    links: list[CalendarLinkOut] = []
