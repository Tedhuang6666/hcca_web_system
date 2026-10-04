"""班聯短網址的管理與公開解析契約。"""

from __future__ import annotations

import unicodedata
from datetime import datetime
from uuid import UUID

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, field_validator, model_validator


class ShortLinkCreate(BaseModel):
    slug: str = Field(..., min_length=1, max_length=80, pattern=r"^[\w-]+$")
    title: str | None = Field(None, min_length=1, max_length=120)
    target_url: AnyHttpUrl

    @field_validator("slug", mode="before")
    @classmethod
    def normalize_slug(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return unicodedata.normalize("NFC", value.strip()).lower()

    @field_validator("target_url")
    @classmethod
    def disallow_url_credentials(cls, value: AnyHttpUrl) -> AnyHttpUrl:
        if value.username is not None or value.password is not None:
            raise ValueError("目的網址不可包含帳號或密碼")
        return value


class ShortLinkUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=120)
    target_url: AnyHttpUrl | None = None
    is_active: bool | None = None

    @field_validator("target_url")
    @classmethod
    def disallow_url_credentials(cls, value: AnyHttpUrl | None) -> AnyHttpUrl | None:
        if value is not None and (value.username is not None or value.password is not None):
            raise ValueError("目的網址不可包含帳號或密碼")
        return value

    @model_validator(mode="after")
    def validate_patch(self) -> ShortLinkUpdate:
        if not self.model_fields_set:
            raise ValueError("請至少修改一個欄位")
        for field in ("target_url", "is_active"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} 不可設為 null")
        return self


class ShortLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    slug: str
    title: str | None
    target_url: AnyHttpUrl
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ShortLinkResolveOut(BaseModel):
    target_url: AnyHttpUrl
