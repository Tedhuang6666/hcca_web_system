"""法規來源同步契約。"""

import re
import uuid
from datetime import datetime
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

DEFAULT_REGULATION_FOLDER = "1DUxeDy7MeN0c_CoeLfd0S7oRWKr6oGkw"


class RegulationSyncSourceUpdate(BaseModel):
    folder_id: str = Field(default=DEFAULT_REGULATION_FOLDER, max_length=300)
    frequency: Literal["manual", "daily", "weekly"] = "daily"

    @field_validator("folder_id")
    @classmethod
    def validate_folder(cls, value: str) -> str:
        value = value.strip()
        if value.startswith("https://"):
            parsed = urlparse(value)
            if parsed.hostname != "drive.google.com":
                raise ValueError("請提供 Google Drive 資料夾網址或 ID")
            match = re.fullmatch(r"/drive/(?:u/\d+/)?folders/([\w-]+)", parsed.path)
            if not match:
                raise ValueError("請提供 Google Drive 資料夾網址")
            value = match.group(1)
        if not re.fullmatch(r"[A-Za-z0-9_-]{10,200}", value):
            raise ValueError("Google Drive 資料夾 ID 格式錯誤")
        return value


class RegulationSyncItemOut(BaseModel):
    filename: str
    title: str | None = None
    file_id: str
    status: Literal["created", "updated", "unchanged", "skipped", "error"]
    detail: str
    regulation_id: uuid.UUID | None = None
    article_count: int = 0


class RegulationSyncReportOut(BaseModel):
    checked_at: datetime | None = None
    error: str | None = None
    items: list[RegulationSyncItemOut] = Field(default_factory=list)


class RegulationSyncSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    folder_id: str
    frequency: Literal["manual", "daily", "weekly"]
    next_sync_at: datetime | None
    requested_at: datetime | None
    last_synced_at: datetime | None
    last_report: RegulationSyncReportOut


class RegulationSyncStatusOut(BaseModel):
    configured: bool
    source: RegulationSyncSourceOut | None = None
    drive_ready: bool
