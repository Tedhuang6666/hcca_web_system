# PROJECT_CONTEXT.md
> 此檔案是專案導覽文件。處理任務時請優先閱讀此檔案，而非掃描所有原始碼。

---

## 一、專案一句話總結

這是一個服務學生代表大會的校園數位治理平台（HCCA），整合公文、法規、會議、
議案、公告、陳情、購票、學餐、問卷、選舉、通知與治理稽核；後端使用
FastAPI + PostgreSQL，前端使用 Next.js 16 + React 19。

---

## 二、技術棧（核心）

| 層 | 技術 |
|----|------|
| 後端 API | Python 3.12 + FastAPI + SQLAlchemy 2.0 async |
| 資料庫 | PostgreSQL 16 + Alembic 遷移 |
| 快取/佇列 | Redis 7 + Celery 5 |
| 搜尋 | Meilisearch |
| 前端 | Next.js 16 App Router + React 19 + TypeScript（Node.js >= 22.13.0） |
| 樣式 | Tailwind CSS 4 |
| 套件管理 | uv Workspaces（後端）/ npm（前端） |
| 可觀測性 | Sentry + PostHog + Prometheus + Grafana |

---

## 三、目錄地圖

### 邏輯核心（高頻修改，優先閱讀）

```
apps/api/src/api/
├── routers/        ← HTTP 端點（唯一的路由層，含權限注入）
│   ├── documents.py / documents_approve.py / documents_attachments.py
│   │                        公文 CRUD、簽核、附件
│   ├── regulations.py      法規 + 版本管理
│   ├── admin.py / admin_system.py  RBAC、系統設定與健康管理
│   ├── meetings.py         會議系統（議程、出席、決議）
│   ├── council_proposals.py / judicial_petitions.py / elections.py
│   │                        議案、司法陳情與選舉
│   ├── school_class.py     班級系統（班級、班級訂購）
│   ├── shop.py             購票 + 商品目錄
│   ├── meal.py             學餐訂購
│   ├── survey.py           問卷
│   ├── email.py / email_platform.py  Email 發送、收件人與平台管理
│   ├── petitions.py        陳情系統
│   ├── announcements.py / notifications.py
│   ├── orgs.py / positions.py / user_positions.py
│   ├── audit.py / analytics.py / saved_filters.py
│   ├── auth.py / users.py / mfa.py / impersonation.py
│   ├── api_keys.py / webhooks.py / public_api.py / feature_flags.py
│   └── ws.py / line_webhook.py / discord.py / metrics_endpoint.py
├── services/       ← 業務邏輯（Router 呼叫 Service，單向依賴）
│   ├── document.py         簽核狀態機核心
│   ├── regulation.py       法規版本狀態機
│   │     └ regulation_consistency.py / regulation_import.py / regulation_tasks.py
│   ├── permission.py       get_user_permission_codes()
│   ├── meeting.py          會議業務邏輯
│   ├── school_class.py     班級業務邏輯
│   ├── shop.py / shop_tasks.py     購票 + Celery 結單
│   ├── meal.py / meal_tasks.py     學餐 + Celery 定時結單
│   ├── survey.py / announcement.py / petition.py
│   ├── email_tasks.py / recipient.py / notification_pref.py
│   ├── outbox.py / outbox_tasks.py 通知 outbox 模式
│   ├── audit.py / audit_chain.py / backup_tasks.py / recovery_tasks.py
│   ├── api_key.py / webhook.py / feature_flag.py / policy.py
│   ├── discord_bot.py / discord_reminders.py / line_bot.py
│   └── org.py / mail.py / storage.py / search.py
├── email/          ← Email 模板渲染（renderer.py, sender.py, templates/）
├── models/         ← SQLAlchemy ORM（只定義結構，無業務邏輯）
│   ├── document.py / regulation.py / org.py / user.py
│   ├── meeting.py / school_class.py / shop.py / meal.py
│   ├── survey.py / announcement.py / petition.py
│   ├── email_message.py / notification.py / outbox.py
│   ├── audit_log.py / audit_anchor.py / backup_record.py / saved_filter.py
│   ├── api_key.py / webhook.py / feature_flag.py / policy.py
│   ├── user_identity.py / discord_account.py
│   └── base.py / types.py（TimestampMixin、共用欄位型別）
├── schemas/        ← Pydantic Create/Update/Out/ListItem（按模組分檔）
└── dependencies/   ← auth.py, permissions.py（require_permission 在此）

apps/web/src/
├── app/            ← Next.js App Router 頁面
│   ├── documents/   公文列表 + 詳情 + 新建 + 編輯
│   ├── regulations/ 法規列表 + 詳情 + 新建 + 編輯 + 修正案
│   ├── meetings/    會議系統
│   ├── shop/        購票（含 cart/、class-orders/）
│   ├── meal/ surveys/（含 [id]/edit/）
│   ├── email/ unsubscribe/   Email 發送與退訂
│   ├── admin/       RBAC 管理（permissions/、classes/）
│   ├── petitions/ announcements/ orgs/ notifications/
│   ├── analytics/ audit-logs/ serial-templates/ document-templates/
│   └── profile/ settings/ auth/ login/ public/
├── components/
│   ├── layout/     AppShell / Sidebar / Topbar / AuthGuard / SocialPresence
│   ├── ui/         通用元件（StatusBadge, GongwenEditor, Drawer, Modal, Combobox, MultiCombobox...）
│   ├── regulations/ LawTree / LawTreeEditor / ArticleDrawer / RegulationDetailSections...
│   ├── documents/  ApprovalPanel.tsx, VersionHistory.tsx
│   ├── announcements/ email/ surveys/ meal/ admin/  各模組專用元件
│   └── providers/  ThemeProvider.tsx
├── lib/
│   ├── api.ts      ← 所有前端 API 呼叫（fetch wrapper）
│   ├── types.ts    ← 前後端共用 TypeScript 型別定義
│   ├── auth-cache.ts / config.ts
│   └── articleTree.ts / regulationStructure.ts / regulationHistory.ts
└── hooks/          usePermissions / useWS / useDraftAutosave / useLazyComponent / usePersistedZoom
```

### 無須深入閱讀（靜態 / 工具性）

```
apps/api/alembic/versions/   ← 歷史遷移（目前約 117 個），只在建立 migration 時參考
apps/api/src/api/email/node_modules/  ← Email 模板工具鏈依賴（compiled/ 為產出）
apps/web/public/             ← 靜態資源（圖片、icon）
.git/ .venv/ .ruff_cache/    ← 工具快取
.pytest_cache/ __pycache__/  ← 測試/編譯快取
uv.lock / package-lock.json  ← 鎖定檔（無需閱讀）
apps/web/next-env.d.ts       ← Next.js 自動生成
參考/ 文件範例/               ← 本地參考用文件（已退出 Git 追蹤，非程式碼）
uploads/                     ← 使用者上傳檔案（已退出 Git 追蹤）
alembic/ （根目錄）           ← 舊殘留目錄，apps/api/alembic/ 才是正確路徑；不可再使用
```

### 設定檔位置速查

```
docker-compose.yml            ← 所有服務的 Docker 定義
apps/api/pyproject.toml       ← Python 依賴 + ruff + pytest 設定
apps/web/package.json         ← Node 依賴
apps/api/alembic.ini          ← Alembic 遷移設定
apps/api/gunicorn.conf.py     ← 生產 server 設定
docs/HANDOFF_CHECKLIST.md     ← 交接檢查清單與驗證指令
```

---

## 四、關鍵上下文

### 目前開發階段

初始 P0–P8 功能藍圖均已完成。目前為**維護、治理強化與生產化階段**，常見任務：
- 修改現有 router / service 邏輯
- 前端頁面 UI 調整（components/、app/ 下頁面）
- 新增 API 欄位（models → schemas → service → router 的固定流程）
- 修正 Alembic migration
- 維護 API key、Webhook、功能旗標、政策同意與稽核鏈
- 強化備份、可觀測性、模組健康與自動恢復

### 最常修改的檔案（依頻率排序）

1. `apps/api/src/api/routers/documents.py` — 公文端點
2. `apps/api/src/api/routers/regulations.py` — 法規端點
3. `apps/api/src/api/routers/admin.py` — 管理功能
4. `apps/web/src/lib/api.ts` — 前端 API 層
5. `apps/web/src/lib/types.ts` — 前端型別
6. `apps/web/src/app/documents/` 下各頁面
7. `apps/web/src/app/regulations/` 下各頁面
8. `apps/web/src/components/layout/Sidebar.tsx` — 導覽列

### 交接前必跑檢查

```bash
uv run --project apps/api ruff check apps/api/src libs/shared/src
uv run --project apps/api ruff format --check apps/api/src libs/shared/src apps/api/tests
uv run --project apps/api pytest apps/api/tests -v --asyncio-mode=auto

cd apps/web
npm run lint
npm run type-check
npm run build  # 需 Node.js >= 22.13.0
npm audit --audit-level=moderate --omit=dev
```

若本機 WSL 仍是 Node 18，可先升級 Node，或暫時用 `npx -y node@24 node_modules/next/dist/bin/next build` 驗證 build。

### 架構鐵律（必須遵守）

- **Router → Service → Model**（單向依賴，禁止逆向）
- **權限檢查只在 Router 層**：`dependencies=[Depends(require_permission("xxx"))]`
- **Service 層假設權限已通過**，不重複驗證
- **不在 async 函式中使用 time.sleep()** 或同步 HTTP（requests）
- **Schema 回應不包裝**：直接回傳 `XxxOut`，不加 `{data: ..., success: true}`
- **不 mock 資料庫**：測試用真實 PostgreSQL 或 aiosqlite

### RBAC 核心函式

```python
# 查詢使用者有效權限（已內建日期篩選）
get_user_permission_codes(db, user_id) -> frozenset[str]

# 主要 Permission 代碼
document:create / document:approve / document:admin
regulation:create / regulation:publish
shop:manage / finance:view / admin:all / doc.issue
```

### 新增 API 端點標準流程

1. `models/` 定義 SQLAlchemy model
2. `alembic revision --autogenerate -m "..."` 建立 migration
3. `schemas/` 定義 `XxxCreate / XxxUpdate / XxxOut / XxxListItem`
4. `services/` 實作業務邏輯
5. `routers/` 新增端點（含 `require_permission`）
6. 前端：更新 `lib/types.ts` → `lib/api.ts` → 對應頁面

---

## 五、建議的協作規範

```
協助維護校園自治平台（HCCA），並維持既有架構與程式風格一致。

行為規則：
1. 每次任務優先閱讀 PROJECT_CONTEXT.md，而非掃描所有原始碼。
2. 需要閱讀程式碼時，依照「目錄地圖 → 邏輯核心」的順序定向閱讀，不掃描 alembic/versions/、快取目錄、鎖定檔。
3. 回覆程式碼時只顯示變動的部分，不重複貼出未修改的程式碼。
4. 架構建議必須符合 Router → Service → Model 單向依賴原則。
5. 所有 DB 操作使用 AsyncSession，禁止同步阻塞呼叫。
6. 若任務涉及資料庫 schema 變更，主動提醒需要建立 Alembic migration。
7. 前端型別定義改動後，主動提醒同步更新 lib/types.ts。
```

---

## 六、雜訊清理建議

下列項目建議從維護資料集中排除，以減少無關內容干擾：

| 項目 | 原因 | 建議處理 |
|------|------|---------|
| `apps/api/alembic/versions/*.py` | 歷史遷移，查詢當前 schema 看 models/ 即可 | 排除或按需讀最新檔案 |
| `uv.lock` | 依賴鎖定檔，無業務邏輯 | 完全排除 |
| `apps/web/package-lock.json` | 同上 | 完全排除 |
| `apps/web/next-env.d.ts` | Next.js 自動生成 | 完全排除 |
| `.ruff_cache/ / .pytest_cache/ / __pycache__/` | 工具快取 | 完全排除 |
| `參考/ 文件範例/` | 本地參考文件 | 按需上傳，非常駐 |
| `uploads/` | 使用者資料 | 完全排除 |
| `apps/api/README.md` / `apps/web/README.md` / `libs/shared/README.md` | 已由本文件整合 | 可排除 |

**預估節省**：移除以上項目後，每次對話可節省約 40–60% 的初始 context 掃描量。

---

*最後更新：2026-06-07 | 維護整理*
