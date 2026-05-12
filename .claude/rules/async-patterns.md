# 非同步程式規範（Async Patterns）

本專案採用 **Async-first** 架構，所有 I/O 操作必須非同步執行。

## 強制規則

### 1. 資料庫操作全部使用 AsyncSession

```python
# ✅ 正確
async def get_document(doc_id: UUID, db: AsyncSession) -> Document | None:
    result = await db.execute(
        select(Document).where(Document.id == doc_id)
    )
    return result.scalar_one_or_none()

# ❌ 錯誤：使用同步 Session
def get_document(doc_id: UUID, db: Session) -> Document | None:
    return db.query(Document).filter(Document.id == doc_id).first()
```

### 2. 禁止 blocking I/O

```python
# ❌ 禁止
import time
async def process():
    time.sleep(5)   # 阻塞整個 event loop

# ✅ 正確
import asyncio
async def process():
    await asyncio.sleep(5)
```

### 3. 禁止在 async 函式中使用同步 HTTP

```python
# ❌ 禁止
import requests
async def call_api():
    resp = requests.get("http://...")  # blocking

# ✅ 正確
import httpx
async def call_api():
    async with httpx.AsyncClient() as client:
        resp = await client.get("http://...")
```

### 4. Celery Task 使用同步函式

Celery 自管 event loop，task 函式**不使用** async：

```python
# ✅ 正確
@celery_app.task
def send_approval_email(document_id: str, recipient_email: str):
    # 使用同步 email 函式
    ...

# ❌ 錯誤
@celery_app.task
async def send_approval_email(...):  # Celery 不支援 async task（需額外設定）
    ...
```

### 5. SQLAlchemy 2.0 查詢風格

```python
# ✅ 使用 select() 語法（2.0 風格）
result = await db.execute(
    select(User)
    .where(User.is_active == True)
    .order_by(User.created_at.desc())
    .limit(20)
)
users = result.scalars().all()

# ❌ 避免舊式 query() 風格
db.query(User).filter(User.is_active == True).all()
```

### 6. 資料庫 Session 管理

Session 由 `get_db()` 依賴注入管理，自動 commit/rollback：

```python
# apps/api/src/api/core/database.py 中已實作：
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
```

**不要在 service 中手動呼叫 `db.commit()`**，除非有特殊理由（如原子操作中間需要刷新）。

## 效能注意事項

- 使用 `selectinload()` 或 `joinedload()` 避免 N+1 查詢
- 大量資料使用 `yield_per()` 分批處理
- 避免在迴圈中執行資料庫查詢
