"""客服作業平台 API schema。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SupportReasonRequest(BaseModel):
    ticket_id: uuid.UUID
    reason: str = Field(min_length=10, max_length=500)


class SupportUserSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    masked_name: str
    email: str
    masked_email: str
    student_id: str | None
    masked_student_id: str | None
    is_active: bool
    is_verified: bool
    mfa_enabled: bool
    is_superuser: bool
    created_at: datetime


class SupportRoleOut(BaseModel):
    id: uuid.UUID
    name: str
    org_id: uuid.UUID
    org_name: str
    start_date: str
    end_date: str | None
    permission_codes: list[str]


class SupportDiagnosticOut(BaseModel):
    code: str
    severity: Literal["info", "warning", "error"]
    message: str
    repair_action: str | None = None


class SupportTicketCompactOut(BaseModel):
    id: uuid.UUID
    ticket_number: str
    title: str
    status: str
    priority: str
    updated_at: datetime


class SupportUserDetailOut(BaseModel):
    user: SupportUserSummaryOut
    linked_emails: list[str]
    masked_linked_emails: list[str]
    account: dict
    roles: list[SupportRoleOut]
    effective_permissions: list[str]
    settings: dict
    tickets: list[SupportTicketCompactOut]
    diagnostics: list[SupportDiagnosticOut] = Field(default_factory=list)


class SupportSensitiveOut(BaseModel):
    user_id: uuid.UUID
    email: str
    linked_emails: list[str]
    student_id: str | None
    reason: str


class SupportProfileUpdateRequest(SupportReasonRequest):
    display_name: str | None = Field(None, min_length=1, max_length=100)
    student_id: str | None = Field(None, max_length=20)
    show_email: bool | None = None
    confirm_change: bool = False


class SupportContactUpdateRequest(SupportReasonRequest):
    email: str = Field(min_length=5, max_length=255)
    confirm_change: bool = False


class SupportApprovalCreateRequest(SupportReasonRequest):
    action: Literal["user.role.grant", "user.profile.restore"]
    target_user_id: uuid.UUID
    payload: dict = Field(default_factory=dict)


class SupportApprovalReviewRequest(BaseModel):
    approved: bool
    note: str = Field(min_length=10, max_length=500)


class SupportTicketCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=10000)
    user_id: uuid.UUID | None = None
    channel: str = Field(default="internal", min_length=1, max_length=32)
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    error_code: str | None = Field(None, max_length=128)
    request_id: str | None = Field(None, max_length=128)
    related_data: dict = Field(default_factory=dict)


class SupportTicketUpdateRequest(BaseModel):
    status: (
        Literal[
            "new",
            "assigned",
            "investigating",
            "waiting_user",
            "waiting_internal",
            "resolved",
            "closed",
            "reopened",
        ]
        | None
    ) = None
    priority: Literal["low", "normal", "high", "urgent"] | None = None
    assigned_to_id: uuid.UUID | None = None
    resolution: str | None = Field(None, max_length=10000)
    note: str | None = Field(None, max_length=5000)


class SupportTicketEventCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=5000)
    event_type: Literal["note", "customer_message", "internal_note", "system"] = "note"


class SupportTicketOut(BaseModel):
    id: uuid.UUID
    ticket_number: str
    title: str
    description: str
    user_id: uuid.UUID | None
    reported_by_user_id: uuid.UUID | None
    assigned_to_id: uuid.UUID | None
    channel: str
    priority: str
    status: str
    error_code: str | None
    request_id: str | None
    related_data: dict
    resolution: str | None
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None
    events: list[dict] = Field(default_factory=list)


class SupportImpersonationStartRequest(SupportReasonRequest):
    target_user_id: uuid.UUID
    mode: Literal["read_only", "interactive"] = "read_only"
    minutes: int = Field(default=15, ge=1, le=30)


class SupportImpersonationStartOut(BaseModel):
    token: str
    session_id: uuid.UUID
    expires_at: datetime
    target_user_id: uuid.UUID
    target_email: str
    target_display_name: str
    actor_email: str
    actor_display_name: str
    read_only: bool


class SupportAssistanceCreateRequest(SupportReasonRequest):
    user_id: uuid.UUID
    expires_minutes: int = Field(default=15, ge=1, le=60)
    current_route: str | None = Field(None, max_length=512)


class SupportAssistanceJoinRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class SupportAssistanceStateRequest(BaseModel):
    current_route: str | None = Field(None, max_length=512)
    client_state: dict = Field(default_factory=dict)


class SupportGuideCreateRequest(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,119}$")
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1, max_length=20000)
    category: str = Field(default="general", min_length=1, max_length=64)
    required_permissions: list[str] = Field(default_factory=list, max_length=20)
    route: str | None = Field(None, max_length=512)


class SupportGuideUpdateRequest(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    summary: str | None = Field(None, min_length=1, max_length=500)
    body: str | None = Field(None, min_length=1, max_length=20000)
    category: str | None = Field(None, min_length=1, max_length=64)
    required_permissions: list[str] | None = Field(None, max_length=20)
    route: str | None = Field(None, max_length=512)
    is_active: bool | None = None


class SupportDashboardOut(BaseModel):
    open_tickets: int
    urgent_tickets: int
    pending_approvals: int
    active_assistance_sessions: int
    active_impersonation_sessions: int
    recent_actions: list[dict]
