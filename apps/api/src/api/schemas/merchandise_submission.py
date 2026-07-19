"""校商投稿 API schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from api.models.merchandise_submission import MerchandiseSubmissionStatus


class TemplateImage(BaseModel):
    url: str = Field(..., min_length=1, max_length=1000)
    label: str = Field(..., min_length=1, max_length=100)


class SubmissionCustomField(BaseModel):
    key: str = Field(..., pattern=r"^[a-z][a-z0-9_]{0,49}$")
    label: str = Field(..., min_length=1, max_length=100)
    field_type: Literal["text", "textarea"] = "text"
    required: bool = False
    placeholder: str | None = Field(None, max_length=200)
    help_text: str | None = Field(None, max_length=500)
    max_length: int = Field(200, ge=1, le=2000)


class MerchandiseSubmissionSettingsUpdate(BaseModel):
    is_open: bool | None = None
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    max_file_size_mb: int | None = Field(None, ge=1, le=250)
    announcement: str | None = Field(None, max_length=3000)


class MerchandiseSubmissionSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    is_open: bool
    opens_at: datetime | None
    closes_at: datetime | None
    max_file_size_mb: int
    announcement: str | None
    updated_at: datetime


class MerchandiseSubmissionItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=3000)
    specification: str | None = Field(None, max_length=10000)
    template_images: list[TemplateImage] = Field(default_factory=list, max_length=12)
    custom_fields: list[SubmissionCustomField] = Field(default_factory=list, max_length=20)
    sort_order: int = 0
    is_active: bool = True
    is_open_override: bool | None = None
    opens_at_override: datetime | None = None
    closes_at_override: datetime | None = None
    max_file_size_mb_override: int | None = Field(None, ge=1, le=250)

    @field_validator("custom_fields")
    @classmethod
    def custom_field_keys_are_unique(
        cls, values: list[SubmissionCustomField]
    ) -> list[SubmissionCustomField]:
        if len({field.key for field in values}) != len(values):
            raise ValueError("自訂欄位代碼不可重複")
        return values


class MerchandiseSubmissionItemUpdate(MerchandiseSubmissionItemCreate):
    name: str | None = Field(None, min_length=1, max_length=200)
    template_images: list[TemplateImage] | None = Field(None, max_length=12)
    custom_fields: list[SubmissionCustomField] | None = Field(None, max_length=20)
    is_active: bool | None = None


class MerchandiseSubmissionItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    specification: str | None
    template_images: list[TemplateImage] = []
    custom_fields: list[SubmissionCustomField] = []
    sort_order: int
    is_active: bool
    is_open_override: bool | None
    opens_at_override: datetime | None
    closes_at_override: datetime | None
    max_file_size_mb_override: int | None
    created_at: datetime
    updated_at: datetime


class MerchandiseSubmissionItemPortalOut(MerchandiseSubmissionItemOut):
    is_accepting: bool
    effective_opens_at: datetime | None
    effective_closes_at: datetime | None
    effective_max_file_size_mb: int


class MerchandiseSubmissionUploadOut(BaseModel):
    storage_key: str
    filename: str
    content_type: str
    file_size: int
    url: str


class MerchandiseSubmissionFileOut(MerchandiseSubmissionUploadOut):
    id: uuid.UUID


class MerchandiseSubmissionSave(BaseModel):
    item_id: uuid.UUID
    field_values: dict[str, str] = Field(default_factory=dict)
    files: list[MerchandiseSubmissionUploadOut] = Field(default_factory=list, max_length=10)


class MerchandiseSubmissionReview(BaseModel):
    status: Literal["reviewing", "approved", "revision_requested", "rejected"]
    review_note: str | None = Field(None, max_length=3000)


class MerchandiseSubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    item_id: uuid.UUID
    item_name: str
    status: MerchandiseSubmissionStatus
    account_snapshot: dict[str, str]
    field_values: dict[str, str]
    files: list[MerchandiseSubmissionFileOut] = []
    submitted_at: datetime | None
    reviewed_at: datetime | None
    reviewer_name: str | None = None
    review_note: str | None
    created_at: datetime
    updated_at: datetime


class MerchandiseSubmissionPortalOut(BaseModel):
    settings: MerchandiseSubmissionSettingsOut
    items: list[MerchandiseSubmissionItemPortalOut]


class MerchandiseSubmissionAdminListItem(MerchandiseSubmissionOut):
    submitter_name: str
    submitter_email: str
    submitter_student_id: str | None
