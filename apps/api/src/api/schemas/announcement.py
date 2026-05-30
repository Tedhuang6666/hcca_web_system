"""公告系統 Pydantic Schemas"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from api.models.announcement import AnnouncementAudience


class AnnouncementMediaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    mime_type: str
    file_size: int
    url: str = ""
    created_at: datetime


class AnnouncementAudienceRef(BaseModel):
    """公告對象（組織或成員）的精簡顯示用結構。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class AnnouncementCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: dict = Field(default_factory=dict, description="Tiptap JSON 內容")
    is_urgent: bool = Field(False, description="是否為緊急公告（觸發首頁 Popup）")
    urgent_until: datetime | None = Field(None, description="緊急公告截止時間（None=永久）")
    org_id: uuid.UUID | None = Field(None, description="所屬組織（None=全站公告）")
    activity_id: uuid.UUID | None = Field(None, description="所屬活動（選填）")
    audience_type: AnnouncementAudience = Field(
        AnnouncementAudience.ALL, description="公告對象（決定可見範圍）"
    )
    audience_org_ids: list[uuid.UUID] = Field(
        default_factory=list, description="對象=特定組織時的目標組織 ID"
    )
    audience_user_ids: list[uuid.UUID] = Field(
        default_factory=list, description="對象=特定成員時的目標使用者 ID"
    )


class AnnouncementUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    content: dict | None = None
    is_urgent: bool | None = None
    urgent_until: datetime | None = None
    is_published: bool | None = None
    activity_id: uuid.UUID | None = None
    audience_type: AnnouncementAudience | None = None
    audience_org_ids: list[uuid.UUID] | None = None
    audience_user_ids: list[uuid.UUID] | None = None


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
    activity_id: uuid.UUID | None = None
    author_id: uuid.UUID
    author_name: str = ""
    created_at: datetime
    updated_at: datetime
    media: list[AnnouncementMediaOut] = []
    audience_type: AnnouncementAudience = AnnouncementAudience.ALL
    audience_orgs: list[AnnouncementAudienceRef] = []
    audience_members: list[AnnouncementAudienceRef] = []


class AnnouncementListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    is_urgent: bool
    is_published: bool
    published_at: datetime | None
    org_id: uuid.UUID | None
    activity_id: uuid.UUID | None = None
    author_id: uuid.UUID
    author_name: str = ""
    created_at: datetime
    audience_type: AnnouncementAudience = AnnouncementAudience.ALL


class AnnouncementStatsOut(BaseModel):
    announcement_id: uuid.UUID
    title: str
    reader_count: int
    published_at: datetime | None
