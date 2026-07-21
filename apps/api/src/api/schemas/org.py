"""組織架構相關 Pydantic Schemas - Org / Position / Permission / UserPosition"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from api.models.meeting import MeetingBillStage
from api.models.org import PositionCategory


# ─────────────────────────────────────────────
# Org
# ─────────────────────────────────────────────
class OrgBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    parent_id: uuid.UUID | None = None
    prefix: str | None = Field(
        None, max_length=20, description="字號前綴，如「嶺代」「嶺學」，用於組合字號模板"
    )
    bill_stage: MeetingBillStage | None = Field(
        None, description="法案審議階段：常務委員會 / 議會，影響此組織會議的議程自動偵測"
    )
    default_permission_codes: list[str] = Field(
        default_factory=list, description="建立職位時預設帶入的權限碼"
    )
    leader_user_id: uuid.UUID | None = Field(
        None, description="指定部門最高權限者；未設定時由同組織最高權限係數任期者遞補"
    )


class OrgCreate(OrgBase):
    pass


class OrgUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    note: str | None = None
    remark: str | None = None
    parent_id: uuid.UUID | None = None
    prefix: str | None = Field(None, max_length=20, description="字號前綴（留空則不更新）")
    bill_stage: MeetingBillStage | None = None
    default_permission_codes: list[str] | None = Field(
        None, description="建立職位時預設帶入的權限碼"
    )
    leader_user_id: uuid.UUID | None = None
    is_active: bool | None = None


class OrgRead(OrgBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    is_active: bool
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
    category: PositionCategory = Field(
        PositionCategory.COUNCIL,
        description="職位分類：council=班聯會/自治組織，class=班級幹部，system=系統/外部協作",
    )
    weight: int = Field(0, ge=0, description="權限係數，同組織內數字越大代表權限越高")
    parent_id: uuid.UUID | None = None


class PositionCreate(PositionBase):
    pass


class PositionUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    note: str | None = None
    remark: str | None = None
    category: PositionCategory | None = None
    weight: int | None = Field(None, ge=0)
    parent_id: uuid.UUID | None = None


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
    # 職位名稱（eagerly loaded from position relationship）
    position_name: str = ""
    position_category: PositionCategory = PositionCategory.COUNCIL
    position_org_id: uuid.UUID | None = None
    position_org_name: str = ""

    @classmethod
    def from_orm_with_details(cls, up: object) -> UserPositionRead:
        obj = cls.model_validate(up)
        pos = getattr(up, "position", None)
        if pos:
            obj.position_name = getattr(pos, "name", "")
            obj.position_category = getattr(pos, "category", PositionCategory.COUNCIL)
            org = getattr(pos, "org", None)
            if org:
                obj.position_org_id = getattr(org, "id", None)
                obj.position_org_name = getattr(org, "name", "")
        return obj
