"""公告系統 Pydantic Schemas"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AnnouncementMediaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    mime_type: str
    file_size: int
    url: str = ""
    created_at: datetime


class AnnouncementCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: dict = Field(default_factory=dict, description="Tiptap JSON 內容")
    is_urgent: bool = Field(False, description="是否為緊急公告（觸發首頁 Popup）")
    urgent_until: datetime | None = Field(None, description="緊急公告截止時間（None=永久）")
    org_id: uuid.UUID | None = Field(None, description="所屬組織（None=全站公告）")


class AnnouncementUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    content: dict | None = None
    is_urgent: bool | None = None
    urgent_until: datetime | None = None
    is_published: bool | None = None


class AnnouncementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    content: dict
    is_urgent: bool
    urgent_until: datetime | None
    is_published: bool
    published_at: datetime | None
    org_id: uuid.UUID | None
    author_id: uuid.UUID
    author_name: str = ""
    created_at: datetime
    updated_at: datetime
    media: list[AnnouncementMediaOut] = []


class AnnouncementListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    is_urgent: bool
    is_published: bool
    published_at: datetime | None
    org_id: uuid.UUID | None
    author_id: uuid.UUID
    author_name: str = ""
    created_at: datetime


class AnnouncementStatsOut(BaseModel):
    announcement_id: uuid.UUID
    title: str
    reader_count: int
    published_at: datetime | None
