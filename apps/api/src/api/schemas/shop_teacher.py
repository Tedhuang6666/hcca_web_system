"""教師商品訂購資料契約。"""

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

ShopName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class ShopOfficeCreate(BaseModel):
    name: ShopName


class ShopOfficeUpdate(BaseModel):
    name: ShopName | None = None
    is_active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=2147483647)

    @model_validator(mode="after")
    def reject_null(self) -> "ShopOfficeUpdate":
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("處室名稱、啟用狀態與顯示順序不可為空值")
        return self


class ShopOfficeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    is_active: bool
    sort_order: int


class ShopTeacherProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ShopName
    office_id: uuid.UUID


class ShopTeacherProfileOut(BaseModel):
    name: str | None = None
    office_id: uuid.UUID | None = None
    office_name: str | None = None
    offices: list[ShopOfficeOut]
