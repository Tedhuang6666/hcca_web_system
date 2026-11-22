"""活動系統 Pydantic Schemas"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from api.models.activity import ActivityStatus


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    org_id: uuid.UUID | None
    starts_at: datetime | None
    ends_at: datetime | None
    order_closes_at: datetime | None = None
    order_closed_at: datetime | None = None
    status: ActivityStatus
    is_active: bool
    created_at: datetime
    updated_at: datetime
