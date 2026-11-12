"""網站漏洞與功能問題回報 Pydantic schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from api.models.site_report import (
    SiteReportKind,
    SiteReportSeverity,
    SiteReportStatus,
)


class SiteReportOptionOut(BaseModel):
    value: str
    label: str
    description: str


class SiteReportPortalOut(BaseModel):
    is_open: bool
    notice: str
    kinds: list[SiteReportOptionOut]
    severities: list[SiteReportOptionOut]


class SiteReportCreate(BaseModel):
    """公開表單輸入；所有長度與格式都在進 DB 前收斂。"""

    kind: SiteReportKind = SiteReportKind.BUG
    severity: SiteReportSeverity = SiteReportSeverity.MEDIUM
    title: str = Field(..., min_length=4, max_length=200)
    description: str = Field(..., min_length=10, max_length=10000)
    steps_to_reproduce: str | None = Field(None, max_length=10000)
    affected_url: str | None = Field(None, max_length=2000)
    contact_email: EmailStr | None = None
    # 機器人誘餌：一般使用者看不到，填了就直接視為垃圾回報。
    website: str | None = Field(None, max_length=200)

    @field_validator("title", "description", mode="before")
    @classmethod
    def strip_required_text(cls, value: object) -> object:
        # 先去除前後空白，讓 min_length 以實際內容計算，避免全空白字串通過驗證。
        return value.strip() if isinstance(value, str) else value

    @field_validator("steps_to_reproduce", mode="before")
    @classmethod
    def strip_optional_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        cleaned = value.strip()
        return cleaned or None

    @field_validator("affected_url")
    @classmethod
    def validate_affected_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if cleaned.startswith("/"):
            return cleaned
        parsed = urlsplit(cleaned)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("請填寫完整網址（http:// 或 https://）或站內路徑")
        return cleaned

    @field_validator("contact_email")
    @classmethod
    def normalize_email(cls, value: EmailStr | None) -> str | None:
        return str(value).strip().lower() if value else None


class SiteReportCreatedOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reference_code: str
    created_at: datetime


class SiteReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reference_code: str
    kind: SiteReportKind
    severity: SiteReportSeverity
    status: SiteReportStatus
    title: str
    description: str
    steps_to_reproduce: str | None
    affected_url: str | None
    contact_email: str | None
    reporter_id: uuid.UUID | None
    user_agent: str | None
    admin_note: str | None
    reviewed_by: uuid.UUID | None
    reviewed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SiteReportUpdate(BaseModel):
    status: SiteReportStatus | None = None
    severity: SiteReportSeverity | None = None
    admin_note: str | None = Field(None, max_length=10000)

    @field_validator("admin_note")
    @classmethod
    def strip_admin_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None
