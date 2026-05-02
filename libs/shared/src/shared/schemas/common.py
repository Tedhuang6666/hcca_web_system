"""共用 Pydantic Schema - 基礎回應格式"""

from pydantic import BaseModel, ConfigDict


class BaseSchema(BaseModel):
    """所有 Schema 的基礎類別"""

    model_config = ConfigDict(from_attributes=True)


class SuccessResponse[DataT](BaseSchema):
    """標準成功回應格式"""

    success: bool = True
    data: DataT


class ErrorResponse(BaseSchema):
    """標準錯誤回應格式"""

    success: bool = False
    error: str
    detail: str | None = None


class PaginatedResponse[DataT](BaseSchema):
    """分頁回應格式"""

    success: bool = True
    data: list[DataT]
    total: int
    page: int
    page_size: int
    total_pages: int
