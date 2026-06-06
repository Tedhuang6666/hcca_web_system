from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class EmailTemplatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    visibility: Literal["private", "org"] = "private"
    org_id: uuid.UUID | None = None
    content: dict = Field(default_factory=dict)
    variable_definitions: list[dict] = Field(default_factory=list)
    is_favorite: bool = False


class EmailTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    visibility: Literal["private", "org"] | None = None
    org_id: uuid.UUID | None = None
    content: dict | None = None
    variable_definitions: list[dict] | None = None
    is_favorite: bool | None = None
    is_active: bool | None = None


class EmailTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_id: uuid.UUID
    org_id: uuid.UUID | None
    visibility: str
    name: str
    description: str
    content: dict
    variable_definitions: list
    is_favorite: bool
    is_active: bool
    current_version: int
    last_used_at: datetime | None
    created_at: datetime
    updated_at: datetime


class EmailTemplateVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    template_id: uuid.UUID
    version: int
    content: dict
    variable_definitions: list
    created_by_id: uuid.UUID | None
    created_at: datetime


class EmailRecipientListMemberIn(BaseModel):
    user_id: uuid.UUID | None = None
    email: EmailStr
    name: str | None = Field(default=None, max_length=100)
    variables: dict[str, str] = Field(default_factory=dict)


class EmailRecipientListPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    visibility: Literal["private", "org"] = "private"
    org_id: uuid.UUID | None = None
    recipient_spec: dict = Field(default_factory=dict)
    variable_definitions: list[dict] = Field(default_factory=list)
    members: list[EmailRecipientListMemberIn] = Field(default_factory=list, max_length=5000)


class EmailRecipientListUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    visibility: Literal["private", "org"] | None = None
    org_id: uuid.UUID | None = None
    recipient_spec: dict | None = None
    variable_definitions: list[dict] | None = None
    members: list[EmailRecipientListMemberIn] | None = Field(default=None, max_length=5000)
    is_active: bool | None = None


class EmailRecipientListMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID | None
    email: str
    name: str | None
    variables: dict


class EmailRecipientListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_id: uuid.UUID
    org_id: uuid.UUID | None
    visibility: str
    name: str
    description: str
    recipient_spec: dict
    variable_definitions: list
    is_active: bool
    members: list[EmailRecipientListMemberOut]
    created_at: datetime
    updated_at: datetime


class EmailAttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    message_id: uuid.UUID | None
    template_id: uuid.UUID | None
    filename: str
    content_type: str
    file_size: int
    delivery_mode: str
    expires_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class EmailPreflightInput(BaseModel):
    recipient_spec: dict = Field(default_factory=dict)
    variable_definitions: list[dict] = Field(default_factory=list)
    default_variables: dict[str, str] = Field(default_factory=dict)
    recipient_variables: list[EmailRecipientListMemberIn] = Field(default_factory=list)
    attachment_ids: list[uuid.UUID] = Field(default_factory=list)


class EmailPreflightOut(BaseModel):
    valid: bool
    resolved_count: int
    unique_count: int
    duplicate_emails: list[str]
    invalid_emails: list[str]
    suppressed_emails: list[str]
    missing_names: list[str]
    missing_variables: list[str]
    attachment_total_bytes: int
    attachment_warnings: list[str]
    quota_remaining: int | None
    estimated_batches: int


class EmailAnalyticsOut(BaseModel):
    message_id: uuid.UUID
    recipients: int
    delivered: int
    bounced: int
    complained: int
    opened: int
    clicked: int
    delivery_rate: float
    bounce_rate: float
    open_rate_estimated: float
    click_rate: float
    unopened_emails: list[str]
    top_links: list[dict]


class EmailSampleSendInput(BaseModel):
    recipient_indexes: list[int] = Field(default_factory=list, max_length=10)
    test_emails: list[EmailStr] = Field(default_factory=list, max_length=10)
