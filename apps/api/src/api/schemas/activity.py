"""活動系統 Pydantic Schemas"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from api.models.activity import ActivityStatus


class ActivityCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    org_id: uuid.UUID | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    status: ActivityStatus = ActivityStatus.DRAFT

    @model_validator(mode="after")
    def validate_time_range(self) -> ActivityCreate:
        if self.starts_at and self.ends_at and self.ends_at < self.starts_at:
            raise ValueError("活動結束時間不可早於開始時間")
        return self


class ActivityUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    org_id: uuid.UUID | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    status: ActivityStatus | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def validate_time_range(self) -> ActivityUpdate:
        if self.starts_at and self.ends_at and self.ends_at < self.starts_at:
            raise ValueError("活動結束時間不可早於開始時間")
        return self


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    org_id: uuid.UUID | None
    starts_at: datetime | None
    ends_at: datetime | None
    status: ActivityStatus
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ActivityConvenerCreate(BaseModel):
    user_id: uuid.UUID
    start_date: date
    end_date: date | None = None

    @model_validator(mode="after")
    def validate_term(self) -> ActivityConvenerCreate:
        if self.end_date and self.end_date < self.start_date:
            raise ValueError("總召任期結束日不可早於開始日")
        return self


class ActivityConvenerUpdate(BaseModel):
    start_date: date | None = None
    end_date: date | None = None


class ActivityConvenerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    activity_id: uuid.UUID
    user_id: uuid.UUID
    start_date: date
    end_date: date | None
    created_at: datetime
    updated_at: datetime
    user_name: str = ""
    user_email: str = ""

    @model_validator(mode="before")
    @classmethod
    def from_orm_with_user(cls, data: object) -> object:
        if isinstance(data, dict):
            return data
        user = getattr(data, "user", None)
        return {
            "id": getattr(data, "id", None),
            "activity_id": getattr(data, "activity_id", None),
            "user_id": getattr(data, "user_id", None),
            "start_date": getattr(data, "start_date", None),
            "end_date": getattr(data, "end_date", None),
            "created_at": getattr(data, "created_at", None),
            "updated_at": getattr(data, "updated_at", None),
            "user_name": getattr(user, "display_name", "") if user else "",
            "user_email": getattr(user, "email", "") if user else "",
        }
