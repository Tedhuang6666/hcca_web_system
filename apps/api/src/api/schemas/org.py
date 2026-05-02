"""組織架構相關 Pydantic Schemas - Org / Position / Permission / UserPosition"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


# ─────────────────────────────────────────────
# Org
# ─────────────────────────────────────────────
class OrgBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    parent_id: uuid.UUID | None = None


class OrgCreate(OrgBase):
    pass


class OrgUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    parent_id: uuid.UUID | None = None


class OrgRead(OrgBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class OrgTree(OrgRead):
    """OrgRead + 遞迴子節點（樹狀結構）"""

    children: list[OrgTree] = []


OrgTree.model_rebuild()


# ─────────────────────────────────────────────
# Permission
# ─────────────────────────────────────────────
class PermissionCreate(BaseModel):
    code: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-z_]+:[a-z_]+$")


class PermissionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    position_id: uuid.UUID
    code: str


# ─────────────────────────────────────────────
# Position
# ─────────────────────────────────────────────
class PositionBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None


class PositionCreate(PositionBase):
    pass


class PositionUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None


class PositionRead(PositionBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    permissions: list[PermissionRead] = []


# ─────────────────────────────────────────────
# UserPosition (任期)
# ─────────────────────────────────────────────
class UserPositionCreate(BaseModel):
    user_id: uuid.UUID
    position_id: uuid.UUID
    start_date: date
    end_date: date | None = None


class UserPositionUpdate(BaseModel):
    end_date: date | None = None


class UserPositionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    position_id: uuid.UUID
    start_date: date
    end_date: date | None
    created_at: datetime
    updated_at: datetime
