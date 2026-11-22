"""共用應收款 schemas。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from api.models.receivable import ReceivableSource, ReceivableStatus


class ReceivableCreate(BaseModel):
    source_type: ReceivableSource = ReceivableSource.MANUAL
    source_id: uuid.UUID | None = None
    activity_id: uuid.UUID | None = None
    org_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    class_id: uuid.UUID | None = None
    title: str = Field(..., min_length=1, max_length=240)
    amount: int = Field(..., ge=0)
    due_at: datetime | None = None
    note: str | None = None

    @model_validator(mode="after")
    def validate_payer(self) -> ReceivableCreate:
        if self.user_id is None and self.class_id is None:
            raise ValueError("應收款需指定使用者或班級")
        return self


class ReceivableUpdate(BaseModel):
    activity_id: uuid.UUID | None = None
    org_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    class_id: uuid.UUID | None = None
    title: str | None = Field(None, min_length=1, max_length=240)
    amount: int | None = Field(None, ge=0)
    paid_amount: int | None = Field(None, ge=0)
    refunded_amount: int | None = Field(None, ge=0)
    status: ReceivableStatus | None = None
    due_at: datetime | None = None
    note: str | None = None


class ReceivablePaymentIn(BaseModel):
    paid_amount: int | None = Field(None, ge=0)
    note: str | None = None


class ReceivableRefundIn(BaseModel):
    refunded_amount: int | None = Field(None, ge=0)
    note: str | None = None


class ReceivableOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_type: ReceivableSource
    source_id: uuid.UUID | None
    activity_id: uuid.UUID | None
    org_id: uuid.UUID | None
    user_id: uuid.UUID | None
    class_id: uuid.UUID | None
    title: str
    amount: int
    paid_amount: int
    refunded_amount: int
    status: ReceivableStatus
    collected_by_id: uuid.UUID | None
    paid_at: datetime | None
    refunded_at: datetime | None
    due_at: datetime | None
    note: str | None
    created_at: datetime
    updated_at: datetime


class ReceivableSummaryOut(BaseModel):
    total_count: int = 0
    total_amount: int = 0
    paid_amount: int = 0
    unpaid_amount: int = 0
    refunded_amount: int = 0
    by_status: dict[str, int] = Field(default_factory=dict)
