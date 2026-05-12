# 校園自治整合平台（HCCA）

服務學生代表大會的校園數位治理平台，包含公文簽核、法規維護、公告、購票、學餐訂購、問卷與 RBAC 權限管理。

## 快速啟動

```bash
bash dev.sh
```

單獨啟動後端：

```bash
docker compose up db redis -d
uv run --project apps/api alembic upgrade head
uv run --project apps/api uvicorn api:app --reload --port 8000
```

單獨啟動前端：

```bash
cd apps/web
npm install
npm run dev
```

前端需要 Node.js `>=20.9.0`。

## 交接驗證

```bash
uv run --project apps/api ruff check apps/api/src libs/shared/src
uv run --project apps/api ruff format --check apps/api/src libs/shared/src apps/api/tests
uv run --project apps/api pytest apps/api/tests -v --asyncio-mode=auto

cd apps/web
npm run lint
npm run build
npm audit --audit-level=moderate --omit=dev
```

更多交接細節請看 [docs/HANDOFF_CHECKLIST.md](docs/HANDOFF_CHECKLIST.md)。

## 重要目錄

- `apps/api/`：FastAPI、SQLAlchemy async、Alembic、Celery。
- `apps/web/`：Next.js App Router、React、Tailwind CSS。
- `libs/shared/`：共用 Pydantic schema 與基礎型別。
- `docs/`：交接、驗證與 AI 工作流文件。

`uploads/`、`.env`、`參考/`、`文件範例/` 屬於本機資料或參考素材，不進 Git。
