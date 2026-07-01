"""角色視角導覽設定 schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class NavigationProfileSection(BaseModel):
    id: str = Field(..., min_length=1, max_length=80)
    heading: str = Field(..., min_length=1, max_length=100)
    items: list[str] = Field(default_factory=list)
    collapsible: bool = False
    default_collapsed: bool = False


class NavigationProfileBase(BaseModel):
    key: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-zA-Z0-9_-]+$")
    label: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    audience: str | None = Field(None, max_length=200)
    priority: int = Field(100, ge=0, le=10_000)
    is_active: bool = True
    match_any_permissions: list[str] = Field(default_factory=list)
    match_any_prefixes: list[str] = Field(default_factory=list)
    exclude_permissions: list[str] = Field(default_factory=list)
    exclude_prefixes: list[str] = Field(default_factory=list)
    desktop_sections: list[NavigationProfileSection] = Field(default_factory=list)
    mobile_order: list[str] = Field(default_factory=list)
    position_ids: list[uuid.UUID] = Field(default_factory=list)


class NavigationProfileCreate(NavigationProfileBase):
    pass


class NavigationProfileUpdate(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    audience: str | None = Field(None, max_length=200)
    priority: int | None = Field(None, ge=0, le=10_000)
    is_active: bool | None = None
    match_any_permissions: list[str] | None = None
    match_any_prefixes: list[str] | None = None
    exclude_permissions: list[str] | None = None
    exclude_prefixes: list[str] | None = None
    desktop_sections: list[NavigationProfileSection] | None = None
    mobile_order: list[str] | None = None
    position_ids: list[uuid.UUID] | None = None


class NavigationProfileOut(NavigationProfileBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    is_system: bool = False
    created_at: datetime
    updated_at: datetime


class NavigationProfileResolveOut(BaseModel):
    profile: NavigationProfileOut | None
    source: str = Field(..., description="position / permission / default / none")
    matched: dict[str, Any] = Field(default_factory=dict)
