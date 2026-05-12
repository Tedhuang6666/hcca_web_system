# 測試標準（Testing Standards）

測試放在 `apps/api/tests/`，使用 pytest + pytest-asyncio。

## 基本設定

```toml
# apps/api/pyproject.toml 中（已設定）
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

## 命名規範

```
test_<動作>_<情境>_<預期結果>

# 範例
test_create_document_without_permission_returns_403
test_submit_document_with_valid_approver_changes_status_to_pending
test_allocate_serial_concurrent_calls_returns_unique_numbers
test_login_with_invalid_token_returns_401
```

## 不 Mock 資料庫

**規則**：不使用 Mock 資料庫，使用真實 DB 連線。

**原因**：過去曾發生 mock 測試通過但 production migration 失敗的問題。

```python
# ✅ 正確：使用真實 DB session
async def test_create_document(db: AsyncSession, test_user: User):
    doc = await document_service.create(db, test_user, DocumentCreate(...))
    assert doc.id is not None
    assert doc.status == DocumentStatus.DRAFT

# ❌ 錯誤：mock 資料庫
async def test_create_document():
    mock_db = MagicMock()
    mock_db.execute.return_value = ...  # 無法測試真實 SQL 行為
```

## 測試 DB 設定

CI 環境使用 PostgreSQL（見 `.github/workflows/ci.yml`）：

```yaml
DATABASE_URL: postgresql+asyncpg://postgres:postgres@localhost:5432/campus_platform_test
```

本地開發若無 PostgreSQL，可使用 aiosqlite：

```python
# conftest.py
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession

@pytest.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSession(engine) as session:
        yield session
```

## 覆蓋率要求

每個 router 模組至少需要：

1. **Happy path**：正常情況成功
2. **Auth 失敗**：無 token 或 token 過期 → 401
3. **權限不足**：有 token 但缺少 permission → 403
4. **資源不存在**：有效 token + 權限但 ID 不存在 → 404

```python
# 範例：四個基本測試
async def test_create_document_success(client, auth_headers, db):
    resp = await client.post("/documents", json={...}, headers=auth_headers)
    assert resp.status_code == 201

async def test_create_document_no_token_returns_401(client):
    resp = await client.post("/documents", json={...})
    assert resp.status_code == 401

async def test_create_document_no_permission_returns_403(client, auth_headers_no_perm):
    resp = await client.post("/documents", json={...}, headers=auth_headers_no_perm)
    assert resp.status_code == 403

async def test_get_document_not_found_returns_404(client, auth_headers):
    resp = await client.get("/documents/00000000-0000-0000-0000-000000000000", headers=auth_headers)
    assert resp.status_code == 404
```

## Celery Task 測試

在測試設定中開啟 eager 模式（同步執行）：

```python
# conftest.py
@pytest.fixture(autouse=True)
def celery_eager(settings):
    settings.CELERY_TASK_ALWAYS_EAGER = True
    settings.CELERY_TASK_EAGER_PROPAGATES = True
```

## Fixtures 慣例

- `db`：AsyncSession（每個 test 獨立事務，測試後 rollback）
- `client`：AsyncClient（使用 httpx）
- `test_user`：已建立的測試使用者
- `auth_headers`：含有效 JWT 的 headers dict
- `test_org`、`test_position`：組織架構測試資料
