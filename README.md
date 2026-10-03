# 竹嶺班聯數位整合系統

隸屬新竹高中班聯會的數位整合平台，整合公文與法規、
公告與陳情、購票、問卷、選舉、通知及 RBAC 權限管理。

## 技術架構

- API：Python 3.12、FastAPI、SQLAlchemy 2.0 async、PostgreSQL 16。
- Web：Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4。
- 背景服務：Redis、Celery、Celery Beat、WebSocket、Meilisearch。
- 外部整合：Google OAuth/OIDC、LINE、Discord、Email、Sentry、PostHog。
- 部署：Docker Compose、Caddy、Prometheus、Grafana、blue-green deployment。

## 文件目錄

- `apps/api/`：FastAPI、SQLAlchemy async、Alembic、Celery。
- `apps/web/`：Next.js App Router、React、Tailwind CSS。
- `libs/shared/`：共用 Pydantic schema 與基礎型別。
- `infra/`：Caddy、Prometheus、Grafana 設定。
- `deploy/`：部署相關資源。
- `scripts/`：維運、部署與檢查腳本。
- `docs/`：各式文件。

## 文件入口

- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)：架構地圖與目前開發上下文。
- [AGENTS.md](AGENTS.md)：協作與程式規範。
- [apps/api/README.md](apps/api/README.md)：API 開發方式。
- [apps/web/README.md](apps/web/README.md)：前端開發方式。
- [docs/README.md](docs/README.md)：現行文件與歷史報告索引。
- [docs/HANDOFF_CHECKLIST.md](docs/HANDOFF_CHECKLIST.md)：交接驗證。
