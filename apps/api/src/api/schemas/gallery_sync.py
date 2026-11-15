"""Drive 圖片來源設定；電子郵件不會寫入公開相簿。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from api.schemas.regulation_sync import RegulationSyncSourceUpdate


class GalleryDriveSource(BaseModel):
    folder_id: str = Field(min_length=1, max_length=300)
    album_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-z0-9][a-z0-9-]*$")
    section: str = Field(default="", max_length=120)
    photographer: str = Field(default="", max_length=120)
    recursive: bool = True

    @field_validator("folder_id")
    @classmethod
    def validate_folder(cls, value: str) -> str:
        return RegulationSyncSourceUpdate.validate_folder(value)

    @field_validator("section", "photographer")
    @classmethod
    def trim_label(cls, value: str) -> str:
        return value.strip()


class GalleryPhotographerMapping(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)

    @field_validator("email", "name", mode="before")
    @classmethod
    def trim_value(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class GalleryDriveConfig(BaseModel):
    sources: list[GalleryDriveSource] = Field(default_factory=list, max_length=50)
    photographers: list[GalleryPhotographerMapping] = Field(default_factory=list, max_length=200)
    frequency: Literal["manual", "quarter_hour", "daily"] = "quarter_hour"

    @model_validator(mode="after")
    def unique_entries(self) -> GalleryDriveConfig:
        keys = [(source.album_id, source.folder_id) for source in self.sources]
        emails = [str(person.email).casefold() for person in self.photographers]
        if len(keys) != len(set(keys)):
            raise ValueError("同一活動的來源資料夾不可重複")
        if len(emails) != len(set(emails)):
            raise ValueError("電子郵件不可重複設定攝影師")
        return self


class GallerySyncReportOut(BaseModel):
    checked_at: datetime | None = None
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    unattributed: int = 0
    errors: list[str] = Field(default_factory=list)


class GalleryDriveStatusOut(BaseModel):
    config: GalleryDriveConfig
    drive_ready: bool
    requested_at: datetime | None = None
    next_sync_at: datetime | None = None
    last_synced_at: datetime | None = None
    last_report: GallerySyncReportOut
