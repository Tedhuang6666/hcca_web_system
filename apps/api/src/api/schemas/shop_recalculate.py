"""訂單優惠手動重算的請求與回應。"""

import uuid
from typing import Literal

from pydantic import BaseModel, Field


class OrderRecalculateRequest(BaseModel):
    order_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)


class OrderRecalculateItem(BaseModel):
    order_id: uuid.UUID
    serial_number: str
    status: Literal["updated", "unchanged", "skipped"]
    reason: str | None = None
    old_total: int
    new_total: int


class OrderRecalculateOut(BaseModel):
    results: list[OrderRecalculateItem]
    updated: int
    unchanged: int
    skipped: int
