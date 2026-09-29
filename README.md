# 竹嶺班聯數位整合系統（HCCA）

服務學生代表大會的校園數位治理平台。系統整合公文與法規、會議與議案、
公告與陳情、購票與學餐、問卷、選舉、通知及 RBAC 權限管理。

## 技術架構

- API：Python 3.12、FastAPI、SQLAlchemy 2.0 async、PostgreSQL 16。
- Web：Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4。
- 背景服務：Redis、Celery、Celery Beat、WebSocket、Meilisearch。
- 外部整合：Google OAuth/OIDC、LINE、Discord、Email、Sentry、PostHog。
- 部署：Docker Compose、Caddy、Prometheus、Grafana、blue-green deployment。

## 快速啟動

需求：WSL 2、Docker、Python 3.12+、`uv`、Node.js >=22.13.0（CI 依 .nvmrc；本機目前使用 Node 24）、npm 10+。

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
uv sync --locked --project apps/api
uv run --locked --directory apps/api alembic upgrade head
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

先讀 [AGENTS.md](AGENTS.md)，依 [驗證矩陣](docs/AI_WORKFLOW.md) 選對應檢查。

```bash
bash scripts/check.sh doctor
bash scripts/check.sh docs
bash scripts/check.sh api
# 先設定明確的本機 PostgreSQL TEST_DATABASE_URL，再執行：
bash scripts/check.sh api-test
bash scripts/check.sh web
```

本機服務與工具限制記錄在 [LOCAL_TOOLING.md](docs/LOCAL_TOOLING.md)。
檢查腳本不啟動／部署服務，資料庫測試不默默退回 SQLite。

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
- [docs/README.md](docs/README.md)：現行文件與歷史報告索引。
- [docs/HANDOFF_CHECKLIST.md](docs/HANDOFF_CHECKLIST.md)：交接驗證。

`uploads/`、`.env` 與本機參考素材不進 Git。修改 ORM model 後必須建立
Alembic migration；修改 API 契約後必須同步前端型別。
