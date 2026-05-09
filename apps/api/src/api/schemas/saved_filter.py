"""Saved filter schemas"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SavedFilterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    scope: str
    name: str
    description: str | None
    params: dict
    share_path: str | None
    created_at: datetime
    updated_at: datetime


class SavedFilterCreate(BaseModel):
    scope: str = Field(..., max_length=50, description="documents/regulations/judicial")
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=200)
    params: dict = Field(default_factory=dict, description="query params JSON")
    share_path: str | None = Field(None, description="optional share path like /documents?...")


class SavedFilterUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, max_length=200)
    params: dict | None = None
    share_path: str | None = None
