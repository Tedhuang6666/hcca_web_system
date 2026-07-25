"""陳情系統 Pydantic Schemas"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from api.models.petition import (
    PetitionAttachmentVisibility,
    PetitionEventType,
    PetitionEventVisibility,
    PetitionPublicStatus,
    PetitionStatus,
)


class PetitionTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    responsible_org_id: uuid.UUID
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime


class PetitionTypeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=2000)
    responsible_org_id: uuid.UUID
    is_active: bool = True
    sort_order: int = Field(0, ge=0)


class PetitionTypeUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, max_length=2000)
    responsible_org_id: uuid.UUID | None = None
    is_active: bool | None = None
    sort_order: int | None = Field(None, ge=0)


class PetitionCreate(BaseModel):
    type_id: uuid.UUID
    is_named: bool = True
    contact_name: str | None = Field(None, max_length=100)
    contact_email: EmailStr | None = None
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=10000)

    @field_validator("contact_name")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class PetitionCreatedOut(BaseModel):
    id: uuid.UUID
    case_number: str
    verification_code: str
    share_token: str
    status: PetitionStatus
    title: str
    status_label: str
    status_public_message: str
    next_action: str
    created_at: datetime


class PetitionSubmitterOut(BaseModel):
    id: uuid.UUID | None = None
    display_name: str | None = None
    email: str | None = None
    student_id: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None


class PetitionAttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    display_name: str | None
    content_type: str | None
    file_size: int | None
    visibility: PetitionAttachmentVisibility
    uploaded_by: uuid.UUID | None
    created_at: datetime
    url: str = ""


class PetitionEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_type: PetitionEventType
    visibility: PetitionEventVisibility
    actor_id: uuid.UUID | None
    from_org_id: uuid.UUID | None
    to_org_id: uuid.UUID | None
    from_status: str | None
    to_status: str | None
    title: str
    content: str | None
    created_at: datetime
    updated_at: datetime
    can_edit: bool = False


class PetitionCaseListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    case_number: str
    type_id: uuid.UUID
    status: PetitionStatus
    public_status: PetitionPublicStatus
    is_named: bool
    title: str
    current_org_id: uuid.UUID
    assigned_to_id: uuid.UUID | None
    submitted_at: datetime
    updated_at: datetime
    status_label: str = ""
    status_public_message: str = ""
    next_action: str = ""
    type_name: str = ""
    current_org_name: str = ""
    assigned_to_name: str | None = None
    discord_guild_id: str | None = None
    discord_channel_id: str | None = None
    discord_channel_created_at: datetime | None = None


class PetitionCaseOut(PetitionCaseListItem):
    content: str
    public_reply: str | None
    public_title: str | None
    public_content: str | None
    public_requested_at: datetime | None
    public_user_responded_at: datetime | None
    public_published_at: datetime | None
    latest_internal_note: str | None = None
    supplement_request: str | None
    rejection_reason: str | None
    submitter_id: uuid.UUID | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    submitted_at: datetime
    assigned_at: datetime | None
    first_response_at: datetime | None
    resolved_at: datetime | None
    closed_at: datetime | None
    can_edit_content: bool = False
    can_supplement: bool = False
    can_respond_public: bool = False
    can_view_submitter: bool = False
    submitter: PetitionSubmitterOut | None = None
    events: list[PetitionEventOut] = []
    attachments: list[PetitionAttachmentOut] = []


class PetitionLookupOut(PetitionCaseOut):
    pass


class PetitionShareLookup(BaseModel):
    """以高熵分享 token 查詢案件；token 僅透過 request body 傳送。"""

    share_token: str = Field(..., min_length=32, max_length=256)


class PetitionSupplementCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)
    verification_code: str | None = Field(None, min_length=5, max_length=5, pattern=r"^\d{5}$")


class PetitionContentUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    content: str | None = Field(None, min_length=1, max_length=10000)
    verification_code: str | None = Field(None, min_length=5, max_length=5, pattern=r"^\d{5}$")

    @model_validator(mode="after")
    def require_content_change(self) -> PetitionContentUpdate:
        if not any(
            field in self.model_fields_set and getattr(self, field) is not None
            for field in ("title", "content")
        ):
            raise ValueError("至少要提供標題或內容")
        return self


class PetitionAssignUpdate(BaseModel):
    assigned_to_id: uuid.UUID
    internal_note: str | None = Field(None, max_length=2000)


class PetitionTransferUpdate(BaseModel):
    to_org_id: uuid.UUID
    reason: str = Field(..., min_length=1, max_length=2000)


class PetitionReplyCreate(BaseModel):
    public_content: str = Field(..., min_length=1, max_length=10000)
    internal_note: str | None = Field(None, max_length=3000)
    resolve: bool = True
    close: bool = False


class PetitionStatusUpdate(BaseModel):
    status: PetitionStatus
    public_message: str | None = Field(None, max_length=5000)
    internal_note: str | None = Field(None, max_length=3000)


class PetitionInternalNoteCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=3000)


class PetitionEventUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    content: str | None = Field(None, min_length=1, max_length=10000)

    @model_validator(mode="after")
    def require_change(self) -> PetitionEventUpdate:
        if not self.model_fields_set:
            raise ValueError("至少要提供標題或訊息內容")
        return self


class PetitionPublicRequest(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    content: str | None = Field(None, min_length=1, max_length=10000)


class PetitionPublicResponse(BaseModel):
    decision: Literal["approve", "approve_with_changes", "reject"]
    title: str | None = Field(None, min_length=1, max_length=200)
    content: str | None = Field(None, min_length=1, max_length=10000)
    verification_code: str | None = Field(None, min_length=5, max_length=5, pattern=r"^\d{5}$")

    @model_validator(mode="after")
    def require_changes(self) -> PetitionPublicResponse:
        if self.decision == "approve_with_changes" and (not self.title or not self.content):
            raise ValueError("修改後同意需同時提供公開標題與公開內容")
        if self.decision != "approve_with_changes" and (self.title or self.content):
            raise ValueError("只有修改後同意可以提供修改內容")
        return self


class PetitionPublicListItem(BaseModel):
    id: uuid.UUID
    case_number: str
    type_name: str
    current_org_name: str
    title: str
    reply: str | None
    published_at: datetime


class PetitionPublicOut(PetitionPublicListItem):
    content: str


class PetitionOrgStatsItem(BaseModel):
    org_id: uuid.UUID
    org_name: str
    total: int
    submitted: int
    assigned: int
    in_progress: int
    needs_info: int
    transferred: int
    resolved: int
    closed: int
    rejected: int
    completed: int
    average_first_response_hours: float | None
    average_completion_hours: float | None


class PetitionStatsOut(BaseModel):
    total: int
    pending_assignment: int
    my_assigned: int
    needs_info: int
    in_progress: int
    resolved: int
    closed_this_month: int
    by_org: list[PetitionOrgStatsItem] = []
