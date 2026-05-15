# UAT 修復驗證清單 (2026-05-15)

## 核心發現

本次 UAT 反馈包含 **13 個問題**，分為 5 個 P0（關鍵）、5 個 P1（重要）、3 個 P2（體驗）項目。**已進行代碼修改的共 29 個檔案**。

---

## ✅ 已確認完成的修復

### P0-3 Modal 捲動錯誤 ✅ DONE
**檔案**: `apps/web/src/components/ui/Modal.tsx`
- [x] 外層 `overflow-y-auto` 與 `max-h-[calc(100vh-2rem)]`
- [x] 內容層 `min-h-0 flex-1 overflow-y-auto`
- [x] 響應式 `items-start sm:items-center`
- ✅ **驗收**：所有 modal 在 375px viewport 可完整操作

### P0-4 Google 名稱覆蓋 ✅ DONE
**檔案**: `apps/api/src/api/routers/auth.py` (L237-259)
- [x] 移除 `user.display_name = display_name` 自動覆蓋邏輯
- [x] 新帳號首次登入仍使用 Google 名稱初始化
- [x] 既有帳號不再被 Google 名稱覆蓋
- ✅ **驗收**：手動改名後重新登入名稱保留

### P0-5 校內帳號限制 ✅ DONE
**檔案**: `apps/api/src/api/core/config.py` + `apps/api/src/api/routers/auth.py`

後端配置：
- [x] `LOGIN_ALLOWED_EMAIL_DOMAINS` (default: `["hchs.hc.edu.tw"]`)
- [x] `LOGIN_EMAIL_ALLOWLIST` (額外例外)
- [x] `OWNER_EMAILS` (不可移除的擁有者)
- [x] `normalize_email_settings()` validator 自動轉小寫並移除 `@`

登入邏輯（L101-113）：
- [x] `_email_can_login()` 函數驗證域名 + allowlist
- [x] 被拒絕時返回友善錯誤訊息：「僅允許竹中 Google 帳號或已核准的管理員帳號登入」
- [x] logging 記錄被拒絕的 email 與客戶端 IP
- [x] 不建立未授權的帳號

環境變數範例（待同步到 `.env.example`）：
```bash
LOGIN_ALLOWED_EMAIL_DOMAINS=hchs.hc.edu.tw
LOGIN_EMAIL_ALLOWLIST=
OWNER_EMAILS=principal@hchs.hc.edu.tw
SUPERUSER_EMAILS=
```

✅ **驗收**：
- [ ] 非 `@hchs.hc.edu.tw` 且非 allowlist 帳號登入被拒
- [ ] `OWNER_EMAILS` 中的帳號仍可登入

---

## 🟡 已部分修復，需要驗證的項目

### P0-1 法規公布狀態與主令公文發布脫鉤 🟡 PARTIAL
**檔案**: `apps/api/src/api/models/regulation.py` + `apps/api/src/api/services/regulation.py`

數據模型（已就位）：
- [x] `published_at: datetime | None` (發布時間)
- [x] `published_document_id: UUID | None` (關聯公文)
- [x] `workflow_status` enum 含 `PUBLISHED` / `REJECTED` / `ARCHIVED`
- [x] `is_active` flag
- [x] `is_repealed`, `repealed_date`, `repeal_reason` (廢止跟蹤)

查詢邏輯修復（L78-97）：
- [x] `_where_publicly_effective()` 要求同時檢查：
  - `published_at IS NOT NULL`
  - `published_document_id IS NOT NULL`
  - `documents.status IN (APPROVED, ARCHIVED)` — 文件必須已發布
- [x] `is_publicly_effective()` 非同步驗證函數

列表與搜尋（L201, L260）：
- [x] `published_only` 改用 `_where_publicly_effective()` 而非只看 `published_at`

⚠️ **待驗證**：
- [ ] 一鍵發布流程是否**原子性**完成：生成主令文件 → 分配字號 → 發布文件 → 標記法規生效
- [ ] 任何步驟失敗時是否有 rollback
- [ ] 後端 migration 是否完全應用（檢查：`uv run --project apps/api alembic current`）
- [ ] 前端 `lib/types.ts` 中 `Regulation` 型別是否同步（含新狀態、新欄位）

### P0-2 草案、修正案與版本 lineage 混亂 🟡 UNCLEAR
**模型檢查**：
- [x] 模型已有 `version: int` (遞增)
- [x] 已有 `is_repealed`, `repeal_replacement_id` (但未確認是否處理修正案 branch)
- ❓ **未找到**：`draft_id`, `amendment_id` 的明確區分
- ❓ **未確認**：修正案建立 branch 或覆蓋邏輯

⚠️ **需要檢查**：
- [ ] `RegulationRevision` 表是否跟蹤完整歷程
- [ ] 送審後編輯邏輯（應拒絕）
- [ ] 修正案是否有獨立的版本鏈
- [ ] 退回再送審是否會產生可追蹤的分支

---

## ✅ 已完成的 P1 修復

### P1-4 `[object Object]` 錯誤訊息 ✅ DONE
**檔案**: `apps/web/src/lib/api.ts`

新增函數（L37-71）：
- [x] `formatErrorDetail()` - 遞迴序列化錯誤細節
  - 處理陣列型 FastAPI 驗證錯誤（提取欄位名與訊息）
  - 處理物件型回應（搜尋 `message`, `msg`, `error`, `detail`）
- [x] `errorMessageFromResponse()` - 從 HTTP 回應提取可讀訊息

所有 API 呼叫現在使用（L155, L170, L288, L412）：
```typescript
throw new ApiError(res.status, await errorMessageFromResponse(res));
```

結果：
- ✅ 表單驗證錯誤顯示欄位名 + 原因（如「email: 必須為有效 email」）
- ✅ 不再出現 `[object Object]`
- ✅ 驗收：新增商品/商家失敗時顯示明確錯誤

---

## 🟡 已修改但需驗證的 P1 項目

### P1-1 Owner / Super Admin / Admin 權限邊界 🟡 CONCEPT ADDED
**狀態**：新增 `OWNER_EMAILS` 概念於 config，但權限強制邏輯未確認。

⚠️ **待驗證**：
- [ ] `admin.py` 是否實現「不可移除 Owner」邏輯
- [ ] `is_superuser` 與 `OWNER_EMAILS` 的關係是否清楚區分
- [ ] UI 是否明確標示 Owner vs Super Admin vs Admin

### P1-2 超管無組織導致卡住 🟡 UNCERTAIN
已觀察的問題場景：
- 新增問卷、學餐、商家時卡住
- 超管不屬於任何組織

⚠️ **待驗證**：
- [ ] Survey, Meal, Shop 服務是否允許 superuser 指定代理組織
- [ ] 前端是否有 org selector dropdown

### P1-3 API 無法連線 🟡 ERROR DISPLAY IMPROVED
**改善**: 錯誤訊息序列化已修復，但網路連線根本原因需測試。

⚠️ **待驗證**：
- [ ] API base URL 配置（檢查 `.env` 與 CORS）
- [ ] 實際發起請求是否連通
- [ ] Network tab 是否有 CORS 錯誤

### P1-5 公文權限與發布流程 🟡 UNCERTAIN
**需求**：
- [ ] `document:admin` 或 `admin:all` 應可檢視所有公文
- [ ] 法規公布流程自動生成修正摘要
- [ ] 主席一鍵發布主令公文

⚠️ **檔案**: `routers/documents.py`, `routers/regulations.py`, `services/document.py`

---

## ❓ 未確認狀態的 P2 項目（可用性）

### P2-1 法條編輯器 UX
- [ ] 層級視覺是否強化
- [ ] 編輯區高度是否增加
- [ ] 是否新增上下移動按鈕

### P2-2 Toggle、Dropdown 與搜尋元件
- [ ] 草稿 toggle CSS 是否修復
- [ ] 權限 dropdown 是否改 virtualized
- [ ] 是否建立共用 combobox

### P2-3 2FA QRCode
- [ ] 後端是否回傳 otpauth URI
- [ ] 前端是否顯示 QRCode

### P2-4 Hydration mismatch
- [ ] 是否移除 SSR 首次 render 中的 `Date.now()`、`localStorage`、`window`

---

## 🔍 驗收檢查表

### 必做項（封鎖發布）
```bash
# 1. 編譯與型別檢查
cd apps/web && npm run type-check
cd apps/api && uv run mypy src/api

# 2. 資料庫遷移
cd apps/api
uv run alembic current  # 應顯示最新 revision
uv run alembic upgrade head  # 確保無錯誤

# 3. API 文件
# 訪問 http://localhost:8000/docs，檢查新增的端點與參數

# 4. 環境變數
cat .env.example | grep -E "LOGIN_|OWNER_"  # 檢查是否已添加
```

### 測試用例（回歸測試）
```bash
# 1. P0-3：Modal 捲動
# 在 375x667 viewport 打開：
# - 權限新增 modal
# - 法條編輯 modal
# - 日誌詳細資訊 modal
# → 確認可完整操作且無背景干擾

# 2. P0-4：Google 名稱保留
# - 建新帳號 A，手動改名為「Bob」
# - 登出，用另一個瀏覽器登入同一帳號 A
# → 確認名字仍為「Bob」，未被 Google 名稱覆蓋

# 3. P0-5：帳號限制
# - 用非 @hchs.hc.edu.tw 帳號登入
# → 應被拒並顯示訊息
# - 用 OWNER_EMAILS 中的帳號登入
# → 應正常登入

# 4. P1-4：錯誤訊息
# - 在商家系統新增商品，留空必填欄位
# → 應顯示「欄位名稱: 驗證錯誤」而非 [object Object]
```

---

## 📋 建議合併前清單

- [ ] 所有 P0 項目通過驗收測試
- [ ] 前端 `lib/types.ts` 型別同步
- [ ] `.env.example` 添加 `LOGIN_*` 與 `OWNER_EMAILS` 配置說明
- [ ] 至少執行一次 `alembic upgrade head` 確認無遷移錯誤
- [ ] 手動測試登入、Modal、錯誤訊息三個核心流程
- [ ] CI/CD 綠燈（型別檢查、linting、測試）

---

*生成日期：2026-05-15 | 檢查者：Claude Code*
