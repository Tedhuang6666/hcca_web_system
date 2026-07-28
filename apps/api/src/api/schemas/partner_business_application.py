"""特約商家申請 Pydantic schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from api.models.partner_business_application import PartnerBusinessApplicationStatus

FieldType = Literal["text", "textarea", "email", "tel", "url", "select"]


class PartnerApplicationFieldConfig(BaseModel):
    key: str = Field(..., pattern=r"^[a-z][a-z0-9_]{0,49}$")
    label: str = Field(..., min_length=1, max_length=100)
    field_type: FieldType = "text"
    required: bool = False
    placeholder: str | None = Field(None, max_length=200)
    help_text: str | None = Field(None, max_length=500)
    options: list[str] = Field(default_factory=list, max_length=20)
    sort_order: int = Field(0, ge=0, le=9999)
    is_active: bool = True

    @field_validator("options")
    @classmethod
    def clean_options(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values if value.strip()]
        if len(cleaned) != len(set(cleaned)):
            raise ValueError("選項不可重複")
        return cleaned

    @model_validator(mode="after")
    def select_requires_options(self) -> PartnerApplicationFieldConfig:
        if self.field_type == "select" and self.is_active and not self.options:
            raise ValueError("下拉選單至少需要一個選項")
        return self


class PartnerApplicationSettingsUpdate(BaseModel):
    is_open: bool | None = None
    title: str | None = Field(None, min_length=1, max_length=200)
    intro: str | None = Field(None, min_length=1, max_length=5000)
    privacy_notice: str | None = Field(None, max_length=5000)
    fields: list[PartnerApplicationFieldConfig] | None = Field(None, max_length=30)

    @field_validator("fields")
    @classmethod
    def unique_field_keys(
        cls, values: list[PartnerApplicationFieldConfig] | None
    ) -> list[PartnerApplicationFieldConfig] | None:
        if values is not None and len({field.key for field in values}) != len(values):
            raise ValueError("申請欄位代碼不可重複")
        return values


class PartnerApplicationFieldOut(PartnerApplicationFieldConfig):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


class PartnerApplicationSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    is_open: bool
    title: str
    intro: str
    privacy_notice: str | None
    fields: list[PartnerApplicationFieldOut]
    updated_at: datetime


class PartnerApplicationPortalOut(BaseModel):
    settings: PartnerApplicationSettingsOut
    is_accepting: bool


class PartnerBusinessApplicationCreate(BaseModel):
    field_values: dict[str, str] = Field(default_factory=dict)


class PartnerBusinessApplicationReview(BaseModel):
    status: PartnerBusinessApplicationStatus
    review_note: str | None = Field(None, max_length=3000)
    business_id: uuid.UUID | None = None


class PartnerBusinessApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: PartnerBusinessApplicationStatus
    field_values: dict[str, str]
    submitted_by: uuid.UUID | None
    reviewed_by: uuid.UUID | None
    reviewed_at: datetime | None
    review_note: str | None
    business_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
