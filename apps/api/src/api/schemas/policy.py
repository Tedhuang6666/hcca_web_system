"""政策（隱私 / ToS / 無障礙 / Cookie / Security）schemas。Phase B1 / ADR-003。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from api.models.policy import PolicyKind, PrivacyRequestStatus, PrivacyRequestType


class PolicyDocumentCreate(BaseModel):
    kind: PolicyKind
    version: str = Field(..., min_length=1, max_length=20)
    title: str = Field(..., min_length=1, max_length=200)
    content_md: str = Field(..., min_length=1)
    summary_md: str | None = None
    effective_at: datetime
    requires_explicit_consent: bool = True


class PolicyDocumentUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    content_md: str | None = None
    summary_md: str | None = None
    effective_at: datetime | None = None
    requires_explicit_consent: bool | None = None


class PolicyDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: PolicyKind
    version: str
    title: str
    content_md: str
    summary_md: str | None
    effective_at: datetime
    is_active: bool
    requires_explicit_consent: bool
    published_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class PolicyDocumentListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: PolicyKind
    version: str
    title: str
    effective_at: datetime
    is_active: bool


class PolicyConsentCreate(BaseModel):
    policy_document_id: uuid.UUID


class PolicyConsentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    policy_document_id: uuid.UUID
    agreed_at: datetime
    ip_address: str | None
    user_agent: str | None
    policy_kind: PolicyKind | None = None
    policy_version: str | None = None
    policy_title: str | None = None


class PendingConsentItem(BaseModel):
    """使用者尚未同意的政策。前端用此清單渲染 modal。"""

    model_config = ConfigDict(from_attributes=True)

    policy_document_id: uuid.UUID
    kind: PolicyKind
    version: str
    title: str
    summary_md: str | None
    effective_at: datetime
    requires_explicit_consent: bool


class PrivacyRequestCreate(BaseModel):
    request_type: PrivacyRequestType
    subject: str = Field(..., min_length=4, max_length=200)
    description: str = Field(..., min_length=10, max_length=4000)


class PrivacyRequestUpdate(BaseModel):
    status: PrivacyRequestStatus
    response_message: str | None = Field(None, max_length=4000)


class PrivacyRequestCancel(BaseModel):
    reason: str | None = Field(None, max_length=1000)


class PrivacyRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    request_type: PrivacyRequestType
    status: PrivacyRequestStatus
    subject: str
    description: str
    submitted_ip_address: str | None
    submitted_user_agent: str | None
    response_message: str | None
    handled_by: uuid.UUID | None
    handled_at: datetime | None
    created_at: datetime
    updated_at: datetime


__all__ = [
    "PendingConsentItem",
    "PolicyConsentCreate",
    "PolicyConsentOut",
    "PolicyDocumentCreate",
    "PolicyDocumentListItem",
    "PolicyDocumentOut",
    "PolicyDocumentUpdate",
    "PrivacyRequestCreate",
    "PrivacyRequestCancel",
    "PrivacyRequestOut",
    "PrivacyRequestUpdate",
]
