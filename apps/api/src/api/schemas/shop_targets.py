"""商品與優惠名單的人員查詢契約。"""

import uuid
from typing import Annotated

from pydantic import BaseModel, Field


class ShopTargetLookupRequest(BaseModel):
    activity_id: uuid.UUID | None = None
    keyword: str = Field("", max_length=100)
    identifiers: list[Annotated[str, Field(max_length=255)]] = Field(
        default_factory=list, max_length=2000
    )


class ShopTargetOut(BaseModel):
    identifier: str
    display_name: str | None = None
    student_id: str | None = None
    email: str | None = None
    class_label: str | None = None
    seat_number: int | None = None
    matched: bool = False
    account_active: bool | None = None
