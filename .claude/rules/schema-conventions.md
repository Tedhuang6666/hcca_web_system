# Pydantic Schema 命名與設計規範

所有 schema 放在 `apps/api/src/api/schemas/` 目錄，按功能模組分檔。

## 命名慣例

| 用途 | 命名後綴 | 說明 |
|------|---------|------|
| POST 請求體 | `XxxCreate` | 必填欄位為主，選填有預設值 |
| PATCH 請求體 | `XxxUpdate` | 所有欄位均為 `Optional`，`None` 代表不更新 |
| 單筆回應 | `XxxOut` | 完整欄位，含 id、timestamps |
| 列表回應 | `XxxListItem` | 精簡欄位（省略大型文字欄位如 content） |
| 內嵌子物件 | `XxxSummary` | 用於巢狀回應中的精簡版本 |

## 標準模板

```python
from pydantic import BaseModel, ConfigDict, Field
from uuid import UUID
from datetime import datetime

# POST body
class DocumentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    category: DocumentCategory
    content: str = ""
    org_id: UUID

# PATCH body（所有欄位 Optional）
class DocumentUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    urgency: UrgencyLevel | None = None

# 單筆回應
class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    category: DocumentCategory
    status: DocumentStatus
    created_by: UUID
    created_at: datetime
    updated_at: datetime

# 列表回應（省略大型欄位）
class DocumentListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    category: DocumentCategory
    status: DocumentStatus
    created_at: datetime
```

## 強制要求

1. **所有回應 schema 必須設定 `model_config = ConfigDict(from_attributes=True)`**
   - 這樣才能直接從 SQLAlchemy ORM 物件建立 schema 實例

2. **`XxxUpdate` 所有欄位必須是 `Optional`（即 `T | None = None`）**
   - Router 應忽略 `None` 值，只更新有提供的欄位

3. **不在 schema 中做業務邏輯**
   - Validator 只做格式驗證（長度、格式、型別）
   - 業務規則（如狀態合法性）在 service 層

4. **Enum 欄位直接使用定義在 `models/` 或 `schemas/` 中的 StrEnum**

## 回應格式（統一用 `XxxOut`，不包裝）

```python
# ✅ 正確：直接回傳 schema
@router.post("/documents", response_model=DocumentOut, status_code=201)
async def create_document(...) -> DocumentOut:
    doc = await document_service.create(db, user, body)
    return DocumentOut.model_validate(doc)

# ❌ 避免：額外包裝
return {"data": doc, "success": True}  # 不要加多餘包裝
```

## 列表端點格式

```python
# 使用內建 list 或 Page schema
@router.get("/documents", response_model=list[DocumentListItem])
async def list_documents(...) -> list[DocumentListItem]:
    docs = await document_service.list(db, ...)
    return [DocumentListItem.model_validate(d) for d in docs]
```
