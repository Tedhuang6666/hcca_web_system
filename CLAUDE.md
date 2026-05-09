# 校園自治整合平台 — CLAUDE.md

> 此檔案是所有 AI 對話的上下文基礎。每次新對話請先閱讀此檔案。

---

## 一、專案願景與規則

**系統名稱**：校園自治整合平台（HCCA Campus Self-Governance Platform）
**定位**：服務學生代表大會的數位治理工具，實現公文管理、法規維護、購票、餐訂與問卷的全平台整合。
**你的定位**:你是這個校園自治平台（HCCA）的開發助手。
**行為規則：**
1. 每次對話優先閱讀 README_FOR_CLAUDE.md，而非掃描所有原始碼。
2. 需要閱讀程式碼時，依照「目錄地圖 → 邏輯核心」的順序定向閱讀，不掃描 alembic/versions/、快取目錄、鎖定檔。
3. 回覆程式碼時只顯示變動的部分，不重複貼出未修改的程式碼。
4. 架構建議必須符合 Router → Service → Model 單向依賴原則。
5. 所有 DB 操作使用 AsyncSession，禁止同步阻塞呼叫。
6. 若任務涉及資料庫 schema 變更，主動提醒需要建立 Alembic migration。
7. 前端型別定義改動後，主動提醒同步更新 lib/types.ts。
其他詳細規則查看@README_FOR_CLAUDE.md
### 開發藍圖（9 階段 41 模組）

| 階段 | 狀態 | 核心功能 |
|------|------|----------|
| P0 基礎建設 | ✅ 完成 | uv Workspaces、Docker、CI/CD |
| P1 身份驗證 | ✅ 完成 | Google OAuth2、JWT 雙 Token、Redis 黑名單 |
| P2 組織與權限 | ✅ 完成 | 組織樹、職位、RBAC 時間任期 |
| P3 共用服務 | ✅ 完成 | Celery、Email、WebSocket、LINE Bot |
| P4 公文與法規 | ✅ 完成 | 簽核狀態機、字號生成、法規條文系統 |
| P5 購票系統 | ✅ 完成 | 樂觀鎖訂單、Pandas 報表 |
| P6 學餐系統 | ✅ 完成 | Celery Beat 定時結單、供應商/菜單/訂單管理 |
| P7 問卷系統 | ✅ 完成 | 動態題型、匿名隔離、統計分析 |
| P8 整合收尾 | ✅ 完成 | Gunicorn + UvicornWorker、Celery Beat、standalone Docker |

---

## 二、技術棧

### 後端（`apps/api/`）

| 類別 | 技術 | 版本 |
|------|------|------|
| 語言 | Python | 3.12+ |
| 框架 | FastAPI | 0.135+ |
| ORM | SQLAlchemy | 2.0 async |
| 遷移 | Alembic | 1.18+ |
| 資料庫 | PostgreSQL | 16-alpine |
| 快取/佇列 | Redis | 7-alpine |
| 任務隊列 | Celery + Redis | 5.3+ |
| 驗證 | Authlib + PyJWT | OAuth2 + HS256 |
| Email | FastAPI-Mail + aiosmtplib | 非同步 SMTP |
| 通知 | LINE Bot SDK | 3.x |
| 資料處理 | Pandas + Openpyxl | 報表匯出 |
| 套件管理 | uv Workspaces | monorepo |
| Lint/Format | Ruff | 行長 100 字符 |
| 測試 | pytest + pytest-asyncio | asyncio_mode=auto |

### 前端（`apps/web/`）

| 類別 | 技術 |
|------|------|
| 框架 | Next.js 16 + React 19（App Router） |
| 樣式 | Tailwind CSS 4 |
| Markdown | react-markdown + remark-gfm |
| 通知 | sonner（Toast） |

### 共用函式庫（`libs/shared/`）

- Pydantic BaseSchema、共用 response 結構
- ORM-agnostic 模型定義

---

## 三、核心架構原則

### 3.1 五權分立映射

本系統以五院制度作為模組職責邊界的設計哲學：

| 職責 | 對應模組 | 關鍵模型/代碼 |
|------|----------|--------------|
| **立法**（規則制定） | 法規系統、文件範本 | `Regulation`, `DocumentSerialTemplate` |
| **行政**（執行流轉） | 公文建立、承辦人管理 | `Document`, `handler_*` 欄位 |
| **司法**（審核裁決） | 多層簽核流程 | `DocumentApproval`, `ApprovalStepStatus` |
| **考試**（驗證合規） | 表單驗證、字號規則 | `Pydantic schemas`, `serial_template` |
| **監察**（稽核追蹤） | 版本歷史、審計軌跡 | `DocumentRevision`, `RegulationRevision` |

### 3.2 RBAC 權限引擎

```
Org（組織）
 └── Position（職位）
      ├── Permission（代碼，如 document:create）
      └── UserPosition（時間任期 start_date / end_date）
```

- **查詢**：`get_user_permission_codes(user_id, date)` → `frozenset[str]`
- **注入**：`dependencies=[Depends(require_permission("xxx"))]` 僅在 **router 層**
- **service 層**可假設權限已通過，不重複驗證

已定義的主要 Permission 代碼：

```
document:create    document:approve    document:admin
regulation:create  regulation:publish
shop:manage
doc.issue          （字號分配）
finance:view       admin:all
```

### 3.3 分層架構

```
apps/api/src/api/
├── core/         # 基礎設施（config, database, security, celery, ws_manager, oauth）
├── dependencies/ # FastAPI 注入點（auth.py, permissions.py）
├── models/       # SQLAlchemy ORM 定義（不含業務邏輯）
├── schemas/      # Pydantic 請求/回應模型
├── routers/      # HTTP 端點（只做路由與參數提取，業務邏輯交給 service）
└── services/     # 業務邏輯（CRUD、狀態機、整合）
```

**鐵律**：
- **Router → Service → Model**（單向依賴，禁止逆向）
- **權限檢查只在 Router 層**：`dependencies=[Depends(require_permission("xxx"))]`
- **Service 層假設權限已通過**，不重複驗證
- **不在 async 函式中使用 time.sleep()** 或同步 HTTP（requests）
- **Schema 回應不包裝**：直接回傳 `XxxOut`，不加 `{data: ..., success: true}`
- **不 mock 資料庫**：測試用真實 PostgreSQL 或 aiosqlite

---

## 四、啟動與開發指令

```bash
# 一鍵啟動（Docker + DB migrations + API + Web）
bash dev.sh

# 單獨啟動 API
docker compose up db redis -d
uv run --project apps/api alembic upgrade head
uv run --project apps/api uvicorn api:app --reload --port 8000

# 建立資料庫 migration（修改 models/ 後必做）
uv run --project apps/api alembic revision --autogenerate -m "簡短描述變更"
uv run --project apps/api alembic upgrade head

# 執行測試
uv run --project apps/api pytest apps/api/tests -v --asyncio-mode=auto

# Lint 與格式化
uv run --project apps/api ruff check apps/api/src libs/shared/src
uv run --project apps/api ruff format apps/api/src libs/shared/src

# 安裝/更新依賴
uv add <package> --project apps/api
uv sync

# 前端開發（在 apps/web/）
npm run dev    # Next.js dev server（port 3000）
npm run build  # 生產建置
```

**API 文件**：啟動後訪問 `http://localhost:8000/docs`（Swagger UI）

---

## 五、代碼風格規範

### 5.1 基本規則

- 行長限制：**100 字符**（Ruff 設定）
- Python 版本：3.12+，使用新語法（`X | Y` 替代 `Optional[X]`）
- 所有 public 函式需型別標注
- 不加不必要的 docstring、helper 或抽象層

### 5.2 Async-first

```python
# ✅ 正確
async def get_document(doc_id: UUID, db: AsyncSession) -> Document:
    result = await db.execute(select(Document).where(Document.id == doc_id))
    return result.scalar_one_or_none()

# ❌ 錯誤：blocking call 在 async 函式中
def get_document(doc_id: UUID):
    time.sleep(1)   # 禁止
```

- DB 操作全部使用 `AsyncSession`
- 禁止在 async 函式中使用 `time.sleep()`（改用 `asyncio.sleep()`）
- Celery task 使用**同步函式**（Celery 自管 event loop）

### 5.3 Pydantic Schema 命名慣例

| 用途 | 命名 | 說明 |
|------|------|------|
| POST body | `XxxCreate` | 必填欄位 |
| PATCH body | `XxxUpdate` | 所有欄位 `Optional` |
| 回應（單筆） | `XxxOut` | 完整欄位 |
| 回應（列表） | `XxxListItem` | 精簡欄位 |

所有 schema 必須設定：
```python
model_config = ConfigDict(from_attributes=True)
```

### 5.4 依賴注入慣例

```python
# 標準型別別名
DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]

# 路由層權限注入
@router.post("/documents", dependencies=[Depends(require_permission("document:create"))])
async def create_document(body: DocumentCreate, db: DbDep, user: CurrentUser):
    return await document_service.create(db, user, body)
```

### 5.5 SQLAlchemy Model 慣例

- 主鍵：UUID（PostgreSQL `UUID` 類型，server_default=`gen_random_uuid()`）
- 時間戳：繼承 `TimestampMixin`（`created_at`, `updated_at`）
- 軟刪除：使用 `is_active: bool = True`，不做實體刪除
- Enum：使用 Python `StrEnum`，存儲為 `String` 類型

---

## 六、測試規範

```python
# 測試命名：test_<動作>_<情境>_<預期結果>
async def test_create_document_without_permission_returns_403():
    ...

async def test_approve_document_by_valid_approver_changes_status():
    ...
```

- 使用 pytest-asyncio，`asyncio_mode = "auto"`
- **不 mock 資料庫**（使用真實 PostgreSQL test DB 或 aiosqlite）
- 每個 router 至少：一個 happy path + 一個 auth 失敗案例
- Celery task 測試：設定 `CELERY_TASK_ALWAYS_EAGER=True`

---

## 七、環境變數速查

`.env.example` 包含所有必要變數，關鍵項：

```bash
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/campus_db
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=<256-bit hex>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
```

---

## 八、常見模式速查

### 新增一個 API 端點

1. 在 `models/` 定義 SQLAlchemy model
2. 建立 Alembic migration：`alembic revision --autogenerate -m "..."`
3. 在 `schemas/` 定義 `XxxCreate / XxxOut`
4. 在 `services/` 實作業務邏輯
5. 在 `routers/` 新增端點（含 `require_permission`）
6. 在 `api/__init__.py` 掛載 router（若新檔案）

### 新增一個 Permission 代碼

1. 在 `dependencies/permissions.py` 或文件中記錄新代碼
2. 在目標 router 的 `dependencies=[Depends(require_permission("xxx"))]` 使用
3. 透過 admin API 將代碼分配給對應的 Position

### 資料庫 migration 流程

```bash
# 1. 修改 apps/api/src/api/models/*.py
# 2. 自動生成 migration
uv run --project apps/api alembic revision --autogenerate -m "add_xxx_table"
# 3. 檢查生成的 migration 檔案（在 apps/api/alembic/versions/）
# 4. 套用
uv run --project apps/api alembic upgrade head
```

---

## 九、安全指南與分析資源

### 已知安全規則（2026-05-07 審查）

- ✅ `rate_limit.py` 降級時記 ERROR log（不靜默 pass）
- ✅ `_user_from_access_token` 只捕捉 `(ExpiredSignatureError, InvalidTokenError)`，避免掩蓋系統錯誤
- ✅ `SUPERUSER_EMAILS` 生產環境禁用（config.py model_validator 強制拋錯）
- ✅ OAuth2 callback 例外不洩漏原始錯誤訊息
- ✅ `.env` 已在 `.gitignore` 排除；`.env.example` 含示範值

### 系統審查文檔（維護參考）

**主索引**：`.claude/analysis/SYSTEM_AUDIT_REPORT.md`
- 系統現狀評分（功能 5/5、代碼品質 3/5、性能 3/5、安全 3/5）
- 4 個 CRITICAL 安全問題及修復方案
- 3 個月優化計畫與 ROI 評估
- 20+ 新增功能優先級清單
- 執行路線圖（Month 1-3）

**安全詳細分析**：`.claude/analysis/SECURITY_ISSUES_DETAILED.md`
- 15 個安全問題（CRITICAL、HIGH、MEDIUM、LOW 分級）
- 每個問題的危害評估 + 程式碼修復範例
- 額外安全建議（CSRF、密碼強度、異常行為偵測）

**功能提案詳細文件**：`.claude/analysis/FEATURE_PROPOSALS_DETAILED.md`
- 20+ 高優先級功能的完整提案
- 後端 + 前端代碼架構模板
- 資料庫 schema 範例與 Alembic migration 指令
- ROI 矩陣與優先級排序

### 修復檢查清單

- [x] 依賴注入層 except Exception 修復（auth.py L36）
- [x] Rate limit middleware 異常日誌（rate_limit.py L79-81）
- [x] 環境變數補全（.env.example 添加 RATE_LIMIT、SUPERUSER_EMAILS）
- [x] SECRET_KEY 生產驗證強化（config.py validator）
- [ ] CSRF 中間件（可選，cookie 已設 samesite=lax 提供保護）
- [ ] 廢止法規管理（models + schemas + services + routers）
- [ ] 審計日誌 UI 完善
- [ ] 2FA 認證（詳見 FEATURE_PROPOSALS_DETAILED.md 第 3.1 節）

---

*最後更新：2026-05-07 | 審查者：Claude Code Agent*
