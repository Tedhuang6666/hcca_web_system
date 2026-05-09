# RBAC 權限注入規範

本系統使用時間有效的 RBAC，所有權限檢查通過 FastAPI 依賴注入實作。

## 核心原則

### 1. 權限檢查只在 Router 層

```python
# ✅ 正確：在 router decorator 中注入
@router.post(
    "/documents",
    dependencies=[Depends(require_permission("document:create"))]
)
async def create_document(body: DocumentCreate, db: DbDep, user: CurrentUser):
    # service 層不需要再檢查權限
    return await document_service.create(db, user, body)

# ❌ 錯誤：在 service 層重複檢查
async def create_document_service(db, user, body):
    codes = await get_user_permission_codes(db, user.id)
    if "document:create" not in codes:  # 重複且多餘
        raise HTTPException(403)
    ...
```

### 2. Service 層假設權限已通過

Service 函式**不接收** permission 相關參數，也不做權限驗證。

```python
# ✅ 正確
async def create(db: AsyncSession, user: User, body: DocumentCreate) -> Document:
    doc = Document(created_by=user.id, **body.model_dump())
    db.add(doc)
    return doc

# ❌ 錯誤：service 做權限判斷
async def create(db, user, body, permission_codes: frozenset):
    if "document:create" not in permission_codes:
        raise ...
```

### 3. 需要 User 物件時使用 CurrentUser

```python
# ✅ 標準注入模式
DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]

@router.get("/me")
async def get_profile(user: CurrentUser, db: DbDep):
    ...
```

### 4. 需要回傳 User 物件的權限注入

`require_permission()` 回傳的依賴**同時驗證權限並回傳 User**：

```python
# 若需要 user 物件，可直接作為參數使用
@router.post("/regulations/{reg_id}/publish")
async def publish_regulation(
    reg_id: UUID,
    db: DbDep,
    user: Annotated[User, Depends(require_permission("regulation:publish"))]
):
    ...
```

### 5. OR 邏輯（任一權限通過）

```python
from api.dependencies.permissions import require_any

@router.get("/admin/reports")
async def get_reports(
    db: DbDep,
    user: Annotated[User, Depends(require_any("finance:view", "admin:all"))]
):
    ...
```

## 時間有效性說明

`get_user_permission_codes(db, user_id)` 內部已做日期篩選：

```sql
WHERE user_positions.start_date <= CURRENT_DATE
  AND (user_positions.end_date IS NULL OR user_positions.end_date >= CURRENT_DATE)
```

**呼叫端不需要再傳入日期參數。**

## 組織範圍存取控制

部分資源需要額外做「組織所屬」驗證（超出 RBAC 範圍），在 service 層處理：

```python
# 例：使用者只能看自己組織的公文
async def list_documents(db, user, org_id: UUID | None):
    user_org_ids = await get_user_org_ids(db, user.id)
    if org_id and org_id not in user_org_ids:
        raise HTTPException(403, "無法存取其他組織的公文")
    ...
```
