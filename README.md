# 校園自治整合平台（HCCA）

服務學生代表大會的校園數位治理平台。系統整合公文與法規、會議與議案、
公告與陳情、購票與學餐、問卷、選舉、通知及 RBAC 權限管理。

## 技術架構

- API：Python 3.12、FastAPI、SQLAlchemy 2.0 async、PostgreSQL 16。
- Web：Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4。
- 背景服務：Redis、Celery、Celery Beat、WebSocket、Meilisearch。
- 外部整合：Google OAuth/OIDC、LINE、Discord、Email、Sentry、PostHog。
- 部署：Docker Compose、Caddy、Prometheus、Grafana、blue-green deployment。

## 快速啟動

需求：WSL 2、Docker、Python 3.12+、`uv`、Node.js 20.9+、npm 10+。

```bash
bash dev.sh
```

啟動後：

- Web：`http://localhost:3000`
- API：`http://localhost:8000`
- Swagger：`http://localhost:8000/docs`
- Flower：`http://localhost:5555`

單獨啟動後端：

```bash
docker compose up db redis -d
uv sync
uv run --project apps/api alembic upgrade head
uv run --project apps/api uvicorn api.main:app --reload --port 8000
```

單獨啟動前端：

```bash
cd apps/web
npm ci
npm run dev
```

環境變數請以 [.env.example](.env.example) 為開發範本；
正式環境使用 [.env.production.example](.env.production.example)。

## 開發驗證

```bash
uv run --project apps/api ruff check apps/api/src libs/shared/src
uv run --project apps/api ruff format --check apps/api/src libs/shared/src apps/api/tests
uv run --project apps/api pytest apps/api/tests -v --asyncio-mode=auto

cd apps/web
npm run lint
npm run type-check
npm run build
npm audit --audit-level=moderate --omit=dev
```

## 重要目錄

- `apps/api/`：FastAPI、SQLAlchemy async、Alembic、Celery。
- `apps/web/`：Next.js App Router、React、Tailwind CSS。
- `libs/shared/`：共用 Pydantic schema 與基礎型別。
- `infra/`：Caddy、Prometheus、Grafana 設定。
- `deploy/`：部署相關資源。
- `scripts/`：維運、部署與檢查腳本。
- `docs/`：交接、驗證與維護流程文件。

## 文件入口

- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)：架構地圖與目前開發上下文。
- [AGENTS.md](AGENTS.md)：協作與程式規範。
- [apps/api/README.md](apps/api/README.md)：API 開發方式。
- [apps/web/README.md](apps/web/README.md)：前端開發方式。
- [docs/HANDOFF_CHECKLIST.md](docs/HANDOFF_CHECKLIST.md)：交接驗證。
- [docs/OPERATIONS_GUIDE.md](docs/OPERATIONS_GUIDE.md)：日常營運。
- [docs/INCIDENT_RUNBOOK.md](docs/INCIDENT_RUNBOOK.md)：故障處理。
- [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md)：正式上線檢查。

`uploads/`、`.env` 與本機參考素材不進 Git。修改 ORM model 後必須建立
Alembic migration；修改 API 契約後必須同步前端型別。
