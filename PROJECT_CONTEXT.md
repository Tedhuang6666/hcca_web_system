# HCCA 專案導覽

> 2026-09-30 依本機程式與設定核對。規範在 [AGENTS.md](AGENTS.md)，驗證指令在
> [docs/AI_WORKFLOW.md](docs/AI_WORKFLOW.md)。先讀此地圖，再定向閱讀相關模組。

服務學生代表大會的校園自治平台，已進入維護與生產化階段。
初始 P0–P8 功能完成是歷史里程碑，不能代表目前每個模組已通過回歸或可直接部署。

## 執行環境與真相來源

| 項目 | 位置與判讀 |
| --- | --- |
| 本機 | WSL `/home/ted98/projects/main`；後續模型繼續使用同一主機 |
| Python | `.python-version`；根 `pyproject.toml` 定義 workspace、Ruff、pytest、coverage 與 mypy gate |
| API 依賴 | `apps/api/pyproject.toml`；workspace lock 在根 `uv.lock` |
| Web 依賴 | `apps/web/package.json`；Node 最低版本看 engines，CI 版本看 `.nvmrc` |
| 框架 | FastAPI + SQLAlchemy async + PostgreSQL 16；Next.js 16 + React 19 + Tailwind 4 |
| 背景 | Redis 7、Celery、Meilisearch；queue 拓撲由 `scripts/validate-celery-topology.py` 驗證 |
| API 啟動 | `api.main:app`；`apps/api/src/api/main.py` 掛 router，不在 `api/__init__.py` 掛載 |
| Web 路由 | `apps/web/src/app/(public)`、`(protected)`、`(admin)`；route group 不出現在 URL |
| 契約 | Pydantic → `openapi.json` → `api-types.ts` → `api-bridge.ts` → `types.ts` 相容層 |
| CI | `.github/workflows/ci.yml`；其他 workflows 是安全／效能／映像檢查 |
| 部署 | `docker-compose*.yml`、`scripts/deploy-smart.sh`、`docs/SMART_DEPLOY.md`；不由一般維護自動觸發 |

不要在根目錄誤裝前端依賴：Web 的 npm 指令用 `npm --prefix apps/web ...`。
Discord bot 在 `apps/discord-bot/`，刻意排除於 uv workspace，需獨立驗證。

## 目錄地圖

```text
apps/api/src/api/
  main.py               FastAPI 掛載、middleware、lifespan
  core/                 config、database、security、celery_app、cache、module_registry
  dependencies/         auth 與 router 權限注入
  routers/              HTTP 路由與參數；查入口先來這裡
  services/             業務邏輯；document/、governance/、shop/ 已是套件，其他依實際模組檔案維護
  models/               SQLAlchemy 定義
  schemas/              請求與回應 Pydantic 型別
  email/                模板與 renderer；node_modules/、compiled/ 按需處理
apps/api/tests/         pytest、共用 conftest.py
apps/api/alembic/       正確的 migration 位置；不要使用根目錄舊 alembic/
apps/web/src/
  app/(public)/         公開頁面
  app/(protected)/      登入後業務頁面
  app/(admin)/          管理頁面
  components/           layout/、ui/ 與領域元件
  lib/api.ts            領域 API re-export 入口
  lib/api/              core.ts fetch 與各領域 API 實作
  lib/api-helpers.ts     ApiError 與錯誤呈現支援
  lib/types.ts          re-export + 手寫相容／前端特有型別
  lib/api-types.ts       生成，勿手改／預讀全文
  lib/api-bridge.ts      生成，別名規則在 scripts/generate-bridge.mjs
  hooks/                權限、資料、WebSocket、UI 狀態
  test/                 Vitest 共用 setup
apps/web/e2e/           Playwright 流程
libs/shared/src/        不反向依賴 api 的共用 schema
scripts/               維護、驗證、部署入口
```

## 按任務選入口

路徑以下以 `apps/api/src/api/` 為基準；測試以 `apps/api/tests/` 為基準。
先用 GitNexus query/context 確認，再閱讀命中的函式和測試。

| 領域 | Router／Service | 測試起點 |
| --- | --- | --- |
| 登入／RBAC | [routers/auth.py](apps/api/src/api/routers/auth.py)、[dependencies/permissions.py](apps/api/src/api/dependencies/permissions.py)、[services/user_session.py](apps/api/src/api/services/user_session.py)、[services/permission.py](apps/api/src/api/services/permission.py) | [test_auth_flows.py](apps/api/tests/test_auth_flows.py)、[test_rbac.py](apps/api/tests/test_rbac.py)、[test_idor.py](apps/api/tests/test_idor.py) |
| 公文 | [routers/documents.py](apps/api/src/api/routers/documents.py)、[routers/documents_approve.py](apps/api/src/api/routers/documents_approve.py)、[services/document/](apps/api/src/api/services/document/) | [test_documents_router.py](apps/api/tests/test_documents_router.py)、[test_documents_approve_router.py](apps/api/tests/test_documents_approve_router.py) |
| 法規 | [routers/regulations.py](apps/api/src/api/routers/regulations.py)、[services/regulation.py](apps/api/src/api/services/regulation.py) | [test_regulations_router.py](apps/api/tests/test_regulations_router.py)、[test_regulation_service.py](apps/api/tests/test_regulation_service.py) |
| 購票 | [routers/shop.py](apps/api/src/api/routers/shop.py)、[services/shop/](apps/api/src/api/services/shop/) | [test_shop_router.py](apps/api/tests/test_shop_router.py)、[test_shop_class.py](apps/api/tests/test_shop_class.py) |
| 學餐（保留模型） | [models/meal.py](apps/api/src/api/models/meal.py)；目前無獨立 meal router，不憑舊藍圖新增端點 | 先確認實際使用場景與掛載，再決定修改範圍 |
| 問卷 | [routers/survey.py](apps/api/src/api/routers/survey.py)、[services/survey.py](apps/api/src/api/services/survey.py) | [test_survey_router.py](apps/api/tests/test_survey_router.py)、[test_survey.py](apps/api/tests/test_survey.py) |
| 班級／人員 | [routers/school_class.py](apps/api/src/api/routers/school_class.py)、[services/school_class.py](apps/api/src/api/services/school_class.py)、[services/person.py](apps/api/src/api/services/person.py) | [test_school_class_router.py](apps/api/tests/test_school_class_router.py)、[test_people_router.py](apps/api/tests/test_people_router.py) |
| 通知／背景 | [services/outbox.py](apps/api/src/api/services/outbox.py)、[services/outbox_tasks.py](apps/api/src/api/services/outbox_tasks.py)、[core/celery_app.py](apps/api/src/api/core/celery_app.py) | [test_outbox_tasks.py](apps/api/tests/test_outbox_tasks.py)、對應 `test_*_tasks.py` |
| 前端 API／驗證 | `apps/web/src/lib/api/core.ts`、`apps/web/src/hooks/usePermissions.ts` | `apps/web/src/lib/api.test.ts`、對應 hooks 測試 |
| 模組啟用／導覽 | [core/module_registry.py](apps/api/src/api/core/module_registry.py)、`apps/web/src/lib/modules.ts`、`apps/web/src/lib/route-manifest.ts` | [test_module_maintenance.py](apps/api/tests/test_module_maintenance.py)、`route-manifest.test.ts`、module registry 檢查 |

權限查詢實際簽名用 context 查 `get_user_permission_codes`；Permission 代碼以
[core/permission_codes.py](apps/api/src/api/core/permission_codes.py) 與 router 的既有依賴為準，不自行發明代碼。

## 開始工作

```bash
git status --short
bash scripts/check.sh doctor
node .gitnexus/run.cjs status
```

`doctor` 是環境診斷，會明示缺件，不能替代測試。完整流程見
[AI_WORKFLOW.md](docs/AI_WORKFLOW.md)，主機已知限制見 [LOCAL_TOOLING.md](docs/LOCAL_TOOLING.md)。

只需載入與任務相關的內容。不要掃 lockfiles、生成型別、歷史 migrations、瀏覽器 profiles、
上傳檔與快取；不要把過往稽核數字或「零漏洞」當成今天的檢查結果。
