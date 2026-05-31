"""Webhook schemas。Phase D2。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from api.models.webhook import DeliveryStatus


class WebhookSubscriptionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    url: HttpUrl
    events: list[str] = Field(..., min_length=1, max_length=64)
    description: str | None = None
    max_retries: int = Field(7, ge=0, le=20)


class WebhookSubscriptionUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    url: HttpUrl | None = None
    events: list[str] | None = None
    description: str | None = None
    is_active: bool | None = None
    max_retries: int | None = Field(None, ge=0, le=20)


class WebhookSubscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    owner_user_id: uuid.UUID
    url: str
    events: list[str]
    is_active: bool
    max_retries: int
    description: str | None
    created_at: datetime
    updated_at: datetime


class WebhookSubscriptionCreatedResponse(BaseModel):
    """建立成功時附帶一次性 HMAC secret。"""

    subscription: WebhookSubscriptionOut
    signing_secret: str = Field(
        ...,
        description="一次性顯示的 HMAC-SHA256 簽章 secret，請妥善保存；之後無法再取得。",
    )


class WebhookDeliveryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    subscription_id: uuid.UUID
    event_type: str
    status: DeliveryStatus
    attempt_count: int
    scheduled_at: datetime
    last_attempted_at: datetime | None
    succeeded_at: datetime | None
    response_status: int | None
    error_message: str | None
    created_at: datetime


__all__ = [
    "WebhookDeliveryOut",
    "WebhookSubscriptionCreate",
    "WebhookSubscriptionCreatedResponse",
    "WebhookSubscriptionOut",
    "WebhookSubscriptionUpdate",
]
