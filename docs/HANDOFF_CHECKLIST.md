# HCCA 交接檢查清單

## 環境

- Python 3.12+，使用 `uv` workspace。
- Node.js 20.9+ 與 npm 10+；Next.js 16 不支援 Node 18。
- PostgreSQL 16、Redis 7；本機可用 `docker compose up db redis -d`。
- `.env` 不進 Git；從 `.env.example` 複製並填入實際值。

## 每次交接前驗證

```bash
uv run --project apps/api ruff check apps/api/src libs/shared/src
uv run --project apps/api ruff format --check apps/api/src libs/shared/src apps/api/tests
uv run --project apps/api pytest apps/api/tests -v --asyncio-mode=auto

cd apps/web
npm run lint
npm run build
npm audit --audit-level=moderate --omit=dev
```

若 WSL 預設 Node 尚未升級，可暫用：

```bash
npx -y node@24 node_modules/next/dist/bin/next build
```

## Git 邊界

- 不追蹤：`.env`、`uploads/`、`參考/`、`文件範例/`、根目錄舊 `alembic/`、Next/Vercel starter SVG、`node_modules/`。
- 正確 Alembic 位置是 `apps/api/alembic/`。
- 修改 ORM model 後必須建立並檢查 Alembic migration。
- 修改前端 API 型別後同步更新 `apps/web/src/lib/types.ts`。

## 安全基線

- 登入狀態以 HttpOnly cookie 與 `/auth/me` 為準；`localStorage` 只做 UI cache。
- WebSocket 使用 cookie 驗證，前端不再把 access token 放在 query string。
- 生產環境必須設定 `ENVIRONMENT=production`、強 `SECRET_KEY`、`COOKIE_SECURE=true`，且不可使用 `SUPERUSER_EMAILS` 自動繞過 RBAC。
- `npm audit --omit=dev` 目前應為 0 vulnerabilities；PostCSS 透過 npm `overrides` 固定到安全版本。

## 已知非阻塞警告

- pytest 目前會出現 SQLite drop table FK cycle 警告，源於測試使用 SQLite 而 schema 有公文/法規互參；不影響測試結果。
- mail task 測試仍可能出現 coroutine mock warning；若要完全消除，下一步應重寫 Celery mail test fixture。

## 後續瘦身優先順序

1. `apps/web/src/app/regulations/[id]/page.tsx`：拆 workflow actions、revision timeline、print/document viewer。
2. `apps/web/src/app/meal/vendor/page.tsx`：拆 vendor/schedule/order/pickup 四個工作區。
3. `apps/api/src/api/routers/documents.py` 與 `routers/regulations.py`：把附件、列印、常用查詢、簽核輔助移到 service 或子 router。
4. `apps/web/src/lib/api.ts`：依 domain 拆成 `documents.ts`、`regulations.ts`、`meal.ts` 等 API slice。
