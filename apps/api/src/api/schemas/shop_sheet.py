"""Google 表單預購同步設定與逐列結果。"""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Column = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


class ShopSheetConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    public_sheet_id: int | None = Field(
        None, ge=0, description="已開放連結讀取的分頁 gid；指定時以匿名唯讀 CSV 匯出讀取"
    )
    identity_column: Column = "時間戳記"
    name_column: Column = "姓名"
    email_column: Column = "電子郵件地址"
    office_column: Column = "辦公室"
    other_office_column: Column | None = "若所屬辦公室未在上列選項"
    ignored_columns: list[Column] = Field(default_factory=lambda: ["職稱"], max_length=100)
    product_columns: dict[Column, uuid.UUID] = Field(default_factory=dict, max_length=100)
    quantity_only_options: dict[uuid.UUID, uuid.UUID] = Field(
        default_factory=dict,
        max_length=100,
        description="只填數量的商品 ID → 預設選項 ID；選項須啟用且不加價",
    )
    max_rows: int = Field(10000, ge=2, le=10000)

    @model_validator(mode="after")
    def distinct_columns(self) -> "ShopSheetConfig":
        columns = [self.identity_column, self.name_column, self.email_column, self.office_column]
        if self.other_office_column:
            columns.append(self.other_office_column)
        if len(set(columns)) != len(columns):
            raise ValueError("姓名、Email、辦公室與識別欄位必須各自不同")
        if set(self.product_columns) & (set(columns) | set(self.ignored_columns)):
            raise ValueError("商品欄位不可同時作為個人資料或忽略欄位")
        return self


class ShopSheetSourceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    spreadsheet_id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{20,200}$")]
    sheet_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ]
    category_id: uuid.UUID
    enabled: bool = False
    config: ShopSheetConfig = Field(default_factory=ShopSheetConfig)


class ShopSheetSourceOut(ShopSheetSourceCreate):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    last_synced_at: datetime | None = None
    last_error: str | None = None


class ShopSheetEnabledUpdate(BaseModel):
    enabled: bool


class ShopSheetRowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    row_number: int
    status: str
    error: str | None
    order_ids: list[str]


class ShopSheetSyncOut(BaseModel):
    imported: int = 0
    updated: int = 0
    skipped: int = 0
    review: int = 0
