# HCCA API

竹嶺班聯數位整合系統後端，採 FastAPI、SQLAlchemy 2.0 async、PostgreSQL、
Redis 與 Celery。

## 啟動

```bash
docker compose up db redis -d
uv sync --locked --project apps/api
uv run --locked --directory apps/api alembic upgrade head
uv run --project apps/api uvicorn api.main:app --reload --port 8000
```

API 文件位於 `http://localhost:8000/docs`。應用程式入口固定為
`api.main:app`；`api/__init__.py` 刻意不載入 Web app，避免 Celery worker
匯入整套 FastAPI。

## 常用指令

從 repo 根目錄執行：

```bash
bash scripts/check.sh api
# 先設定 TEST_DATABASE_URL，指定本機 PostgreSQL *_test DB
bash scripts/check.sh api-test
```

修改 ORM model 後：

```bash
uv run --locked --directory apps/api alembic revision --autogenerate -m "描述"
uv run --locked --directory apps/api alembic upgrade head
```

## 分層規則

```text
Router -> Service -> Model
```

- 權限以 `Depends(require_permission(...))` 放在 router。
- DB 操作一律使用 `AsyncSession`。
- async 程式不得使用同步 HTTP 或 `time.sleep()`。
- API schema 直接回傳，不額外包 `{data, success}`。
- 測試使用 PostgreSQL 或 aiosqlite，不 mock DB。

主要目錄：

- `src/api/main.py`：FastAPI factory、middleware、router 掛載。
- `src/api/routers/`：HTTP 與依賴注入；`finance.py` 聚合總帳、預算、報帳／付款及公開查詢路由。
- `src/api/services/`：業務邏輯與 Celery tasks；`finance.py` 維持服務匯出相容，財務實作分在 `finance_core.py`、`finance_budget.py`、`finance_journal.py`。
- `src/api/services/shop/`：商品目錄、訂單、班級收款、訂單查詢與序列化分模組，`_orders.py` 保留相容匯出。
- `src/api/models/`：SQLAlchemy ORM。
- `src/api/schemas/`：Pydantic schema。
- `alembic/`：資料庫遷移。
- `tests/`：pytest 測試。
