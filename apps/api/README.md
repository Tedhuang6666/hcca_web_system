# HCCA API

校園自治整合平台後端，採 FastAPI、SQLAlchemy 2.0 async、PostgreSQL、
Redis 與 Celery。完整架構請先看 [PROJECT_CONTEXT.md](../../PROJECT_CONTEXT.md)。

## 啟動

```bash
docker compose up db redis -d
uv sync
uv run --project apps/api alembic upgrade head
uv run --project apps/api uvicorn api.main:app --reload --port 8000
```

API 文件位於 `http://localhost:8000/docs`。應用程式入口固定為
`api.main:app`；`api/__init__.py` 刻意不載入 Web app，避免 Celery worker
匯入整套 FastAPI。

## 常用指令

```bash
uv run --project apps/api pytest apps/api/tests -v --asyncio-mode=auto
uv run --project apps/api ruff check apps/api/src libs/shared/src
uv run --project apps/api ruff format --check apps/api/src libs/shared/src apps/api/tests
uv run --project apps/api mypy
```

修改 ORM model 後：

```bash
uv run --project apps/api alembic revision --autogenerate -m "描述"
uv run --project apps/api alembic upgrade head
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
- `src/api/routers/`：HTTP 與依賴注入。
- `src/api/services/`：業務邏輯與 Celery tasks。
- `src/api/models/`：SQLAlchemy ORM。
- `src/api/schemas/`：Pydantic schema。
- `alembic/`：資料庫遷移。
- `tests/`：pytest 測試。
