# UAT 修復進度追蹤 (2026-05-15)

## 修復統計
- **已修改檔案數**：29 個
- **修復完成度**：評估中

---

## P0 必修項目（關鍵修復）

### ✅ P0-3 共用 Modal/Dialog 捲動與定位錯誤
**狀態**：已修復  
**修改**：
- `Modal.tsx` 已實作 `overflow-y-auto` + `max-h-[calc(100vh-2rem)]`
- 外層支援 `items-start` 和 `items-center` 響應式佈局

### ✅ P0-4 Google 登入覆蓋手動名稱
**狀態**：已修復  
**修改**：
- `auth.py` 移除自動同步 `user.display_name = display_name`
- 新建帳號仍使用 Google 名稱初始化，既有帳號不被覆蓋

### ✅ P0-5 校內帳號限制與管理員例外
**狀態**：已修復  
**修改**：
- `config.py` 新增 `LOGIN_ALLOWED_EMAIL_DOMAINS`、`LOGIN_EMAIL_ALLOWLIST`、`OWNER_EMAILS`
- `auth.py` 新增 `_email_can_login()` 驗證
- 非允許域名自動拒絕，並返回友善錯誤訊息

### 🟡 P0-1 法規公布狀態與主令公文發布脫鉤
**狀態**：部分修復  
**進度**：
- ✅ `regulation.py` 新增 `_where_publicly_effective()` 查詢輔助
- ✅ `published_at` 和 `published_document_id` 雙重檢查
- ✅ 公開查詢需要文件狀態為 `APPROVED` 或 `ARCHIVED`
- ❓ 待驗：一鍵發布流程、transaction 原子性
- ❓ 待驗：前端 `lib/types.ts` 同步

### 🟡 P0-2 草案、修正案與版本 lineage 混亂
**狀態**：需評估  
- ❓ 是否新增 `draft_id`、`amendment_id` 來區分版本
- ❓ 是否防止已送審案件編輯
- ❓ 修正案是否建立 branch 而非覆蓋

---

## P1 重要修復

### ✅ P1-4 `[object Object]` 錯誤訊息
**狀態**：已修復  
**修改**：
- `lib/api.ts` 新增 `formatErrorDetail()` 遞迴格式化
- 處理陣列型驗證錯誤、物件欄位提取
- 所有 toast.error() 現在顯示可讀訊息

### 🟡 P1-1 Owner / Super Admin / Admin 權限邊界
**狀態**：新增概念，未知實作  
- ✅ `config.py` 新增 `OWNER_EMAILS` 概念
- ❓ `admin.py` 是否實現不可移除 Owner 邏輯

### 🟡 P1-2 超管無組織導致卡住
**狀態**：需驗證  
- ❓ Survey、Meal、Shop 服務是否允許 superuser 選擇代理組織

### 🟡 P1-3 API 無法連線
**狀態**：改進了錯誤顯示，但需測試實際連線  
- ✅ 改善了錯誤訊息格式
- ❓ base URL 配置是否正確
- ❓ credential / CORS 是否正常

### 🟡 P1-5 公文權限與發布流程
**狀態**：需驗證  
- ❓ `document:admin` 是否可檢視所有公文
- ❓ 法規公布是否自動生成修正摘要

---

## P2 可用性與體驗

### 🟡 P2-1 法條編輯器 UX
**狀態**：未知  
- ❓ 層級視覺是否改進
- ❓ 是否新增上下移動按鈕
- ❓ Tab 是否自動轉層級

### 🟡 P2-2 Toggle、Dropdown 與搜尋元件
**狀態**：未知  
- ❓ 草稿 toggle CSS 是否修復
- ❓ 是否建立共用 combobox/selectable dropdown

### 🟡 P2-3 2FA QRCode
**狀態**：未知  
- ❓ 是否回傳 otpauth URI
- ❓ 前端是否顯示 QRCode

### 🟡 P2-4 Hydration mismatch
**狀態**：未知  
- ❓ 是否移除 SSR 中的 `Date.now()`、`localStorage`、`window` 使用

---

## 建議下一步

1. **立即驗證 P0 完成度**
   ```bash
   # P0-1：測試法規公布流程的交易完整性
   # P0-2：確認版本 lineage、修正案編輯限制
   ```

2. **檢查前端型別同步**
   ```bash
   # apps/web/src/lib/types.ts 是否更新了：
   # - User.profile_name_locked（P0-4）
   # - Regulation 新狀態（如需要）
   ```

3. **測試用例覆蓋**
   ```bash
   # 非校內帳號登入應被拒
   # 手動改名後重新登入不覆蓋
   # 375px viewport modal 完整可操作
   # 法規未發布時不顯示現行有效
   ```

4. **DB Migration 檢查**
   ```bash
   # 確認是否需要執行 alembic upgrade head
   uv run --project apps/api alembic current
   ```

---

*最後更新：2026-05-15*
