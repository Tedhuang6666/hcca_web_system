"""公告系統 Pydantic Schemas"""

from __future__ import annotations

import uuid
from datetime import datetime
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from api.models.announcement import AnnouncementAudience


def _normalize_link_url(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if normalized.startswith("/") and not normalized.startswith("//"):
        return normalized
    parsed = urlparse(normalized)
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return normalized
    raise ValueError("連結須為站內路徑（/開頭）或完整 HTTP(S) 網址")


def _normalize_link_label(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


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
    is_urgent: bool = Field(False, description="是否為重要公告（觸發首頁 Popup）")
    urgent_until: datetime | None = Field(None, description="重要公告截止時間（None=永久）")
    link_url: str | None = Field(None, max_length=500, description="公告的主要導向")
    link_label: str | None = Field(None, max_length=60, description="連結按鈕文字")
    show_on_every_visit: bool = Field(False, description="每次進入系統都顯示重要公告")
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

    _validate_link_url = field_validator("link_url")(_normalize_link_url)
    _validate_link_label = field_validator("link_label")(_normalize_link_label)


class AnnouncementUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    content: dict | None = None
    is_urgent: bool | None = None
    urgent_until: datetime | None = None
    link_url: str | None = Field(None, max_length=500)
    link_label: str | None = Field(None, max_length=60)
    show_on_every_visit: bool | None = None
    is_published: bool | None = None
    activity_id: uuid.UUID | None = None
    audience_type: AnnouncementAudience | None = None
    audience_org_ids: list[uuid.UUID] | None = None
    audience_user_ids: list[uuid.UUID] | None = None

    _validate_link_url = field_validator("link_url")(_normalize_link_url)
    _validate_link_label = field_validator("link_label")(_normalize_link_label)


class AnnouncementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    content: dict
    is_urgent: bool
    urgent_until: datetime | None
    link_url: str | None
    link_label: str | None
    show_on_every_visit: bool
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
