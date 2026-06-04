"""發布中心 schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from api.models.publication import PublicationDeliveryStatus, PublicationStatus


class PublicationCampaignCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=240)
    body: str = Field(..., min_length=1, max_length=20000)
    source_type: str | None = Field(None, max_length=50)
    source_id: uuid.UUID | None = None
    activity_id: uuid.UUID | None = None
    org_id: uuid.UUID | None = None
    audience_type: str = Field("all", max_length=50)
    audience_filter: dict = Field(default_factory=dict)
    channels: list[str] = Field(default_factory=list)
    scheduled_at: datetime | None = None


class PublicationCampaignUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=240)
    body: str | None = Field(None, min_length=1, max_length=20000)
    source_type: str | None = Field(None, max_length=50)
    source_id: uuid.UUID | None = None
    activity_id: uuid.UUID | None = None
    org_id: uuid.UUID | None = None
    audience_type: str | None = Field(None, max_length=50)
    audience_filter: dict | None = None
    channels: list[str] | None = None
    scheduled_at: datetime | None = None
    status: PublicationStatus | None = None


class PublicationDeliveryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campaign_id: uuid.UUID
    channel: str
    recipient_user_id: uuid.UUID | None
    status: PublicationDeliveryStatus
    target: str | None
    provider_message_id: str | None
    error_detail: str | None
    sent_at: datetime | None
    read_at: datetime | None
    clicked_at: datetime | None
    created_at: datetime
    updated_at: datetime


class PublicationCampaignOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    body: str
    source_type: str | None
    source_id: uuid.UUID | None
    activity_id: uuid.UUID | None
    org_id: uuid.UUID | None
    audience_type: str
    audience_filter: dict
    channels: list[str]
    status: PublicationStatus
    scheduled_at: datetime | None
    sent_at: datetime | None
    created_by_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class PublicationPreviewOut(BaseModel):
    title: str
    channels: dict[str, dict[str, str]]
    estimated_recipients: int


class PublicationStatsOut(BaseModel):
    campaign_id: uuid.UUID
    total_deliveries: int = 0
    by_channel: dict[str, int] = Field(default_factory=dict)
    by_status: dict[str, int] = Field(default_factory=dict)
