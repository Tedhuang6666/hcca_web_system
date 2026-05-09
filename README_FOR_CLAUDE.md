# README_FOR_CLAUDE.md
> 此檔案是給 Claude 的導覽文件，優先閱讀此檔案而非掃描所有原始碼。

---

## 一、專案一句話總結

這是一個服務學生代表大會的校園數位治理平台（HCCA），包含公文簽核、法規維護、購票、學餐訂購與問卷等功能，後端使用 FastAPI + PostgreSQL，前端使用 Next.js 16 + React 19。

---

## 二、技術棧（核心）

| 層 | 技術 |
|----|------|
| 後端 API | Python 3.12 + FastAPI + SQLAlchemy 2.0 async |
| 資料庫 | PostgreSQL 16 + Alembic 遷移 |
| 快取/佇列 | Redis 7 + Celery 5 |
| 前端 | Next.js 16 App Router + React 19 + TypeScript（Node.js >= 20.9） |
| 樣式 | Tailwind CSS 4 |
| 套件管理 | uv Workspaces（後端）/ npm（前端） |

---

## 三、目錄地圖

### 邏輯核心（高頻修改，優先閱讀）

```
apps/api/src/api/
├── routers/        ← HTTP 端點（唯一的路由層，含權限注入）
│   ├── documents.py       公文 CRUD + 簽核流程
│   ├── regulations.py     法規 + 版本管理
│   ├── admin.py           管理員 / RBAC 設定
│   ├── announcements.py
│   ├── orgs.py / positions.py / user_positions.py
│   ├── meal.py / shop.py / survey.py
│   └── auth.py / users.py / notifications.py / ws.py
├── services/       ← 業務邏輯（Router 呼叫 Service，單向依賴）
│   ├── document.py        簽核狀態機核心
│   ├── regulation.py      法規版本狀態機
│   ├── permission.py      get_user_permission_codes()
│   ├── org.py / meal.py / shop.py / survey.py
│   └── mail.py / line_bot.py / storage.py
├── models/         ← SQLAlchemy ORM（只定義結構，無業務邏輯）
│   ├── document.py / regulation.py
│   ├── org.py / user.py
│   └── meal.py / shop.py / survey.py / announcement.py
├── schemas/        ← Pydantic Create/Update/Out/ListItem
└── dependencies/   ← auth.py, permissions.py（require_permission 在此）

apps/web/src/
├── app/            ← Next.js App Router 頁面
│   ├── documents/  公文列表 + 詳情 + 新建 + 編輯
│   ├── regulations/ 法規列表 + 詳情 + 新建 + 編輯 + 修正案
│   ├── admin/permissions/  RBAC 管理頁
│   └── ...（announcements, orgs, meal, shop, surveys, notifications）
├── components/
│   ├── layout/     AppShell.tsx（主框架）、Sidebar.tsx、AuthGuard.tsx
│   ├── ui/         通用元件（StatusBadge, GongwenEditor, RichTextarea...）
│   └── documents/  ApprovalPanel.tsx, VersionHistory.tsx
├── lib/
│   ├── api.ts      ← 所有前端 API 呼叫（fetch wrapper）
│   └── types.ts    ← 前後端共用 TypeScript 型別定義
└── hooks/          usePermissions.ts, useWS.ts
```

### 無須深入閱讀（靜態 / 工具性）

```
apps/api/alembic/versions/   ← 56 個遷移檔，僅在建立新 migration 時參考最新一個
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

所有 9 個 P0–P8 階段均已完成。目前為**維護與優化期**，常見任務：
- 修改現有 router / service 邏輯
- 前端頁面 UI 調整（components/、app/ 下頁面）
- 新增 API 欄位（models → schemas → service → router 的固定流程）
- 修正 Alembic migration

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
npm run build  # 需 Node.js >= 20.9
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

## 五、建議的 Claude Projects 指示（貼入 Project Instructions）

```
你是這個校園自治平台（HCCA）的開發助手。

行為規則：
1. 每次對話優先閱讀 README_FOR_CLAUDE.md，而非掃描所有原始碼。
2. 需要閱讀程式碼時，依照「目錄地圖 → 邏輯核心」的順序定向閱讀，不掃描 alembic/versions/、快取目錄、鎖定檔。
3. 回覆程式碼時只顯示變動的部分，不重複貼出未修改的程式碼。
4. 架構建議必須符合 Router → Service → Model 單向依賴原則。
5. 所有 DB 操作使用 AsyncSession，禁止同步阻塞呼叫。
6. 若任務涉及資料庫 schema 變更，主動提醒需要建立 Alembic migration。
7. 前端型別定義改動後，主動提醒同步更新 lib/types.ts。
```

---

## 六、雜訊清理建議

下列項目建議從 Claude Projects 的「知識庫」或上傳檔案中移除，以節省 Token：

| 項目 | 原因 | 建議處理 |
|------|------|---------|
| `apps/api/alembic/versions/*.py`（56 個） | 歷史遷移，查詢當前 schema 看 models/ 即可 | 排除或只保留最新 3 個 |
| `uv.lock` | 依賴鎖定檔，無業務邏輯 | 完全排除 |
| `apps/web/package-lock.json` | 同上 | 完全排除 |
| `apps/web/next-env.d.ts` | Next.js 自動生成 | 完全排除 |
| `.ruff_cache/ / .pytest_cache/ / __pycache__/` | 工具快取 | 完全排除 |
| `參考/ 文件範例/` | 本地參考文件 | 按需上傳，非常駐 |
| `uploads/` | 使用者資料 | 完全排除 |
| `apps/api/README.md` / `apps/web/README.md` / `libs/shared/README.md` | 已由本文件整合 | 可排除 |

**預估節省**：移除以上項目後，每次對話可節省約 40–60% 的初始 context 掃描量。

---

*最後更新：2026-05-02 | 由 Claude 自動生成*
