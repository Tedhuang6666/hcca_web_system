# 竹中班聯網站改進建議 UAT Triage

來源：根目錄 `竹中班聯網站改進建議.pdf`
整理日期：2026-05-15

## 摘要

這份回饋不是單點 bug 清單，而是一次完整的制度流程、權限模型、法規狀態機與 UI 可用性測試。最需要先處理的是會造成錯誤法律狀態、版本資料遺失、權限越界或核心操作卡死的問題。

## P0 必修

### P0-1 法規公布狀態與主令公文發布脫鉤

問題：主席點「公布」後，法規查詢已顯示現行有效，但主令字號公文尚未正式發布。

影響：系統狀態與法律生效依據不一致，屬高風險資料錯誤。

建議修法：
- 將法規生效狀態拆成 `approved`、`promulgation_pending`、`effective` 等明確狀態。
- 只有主令公文發布成功後，法規才能進入 `effective`。
- 若要保留一鍵操作，後端 service 應在同一個交易中完成「生成主令公文、分配字號、發布公文、標記法規生效」。

可能檔案：
- `apps/api/src/api/models/regulation.py`
- `apps/api/src/api/models/document.py`
- `apps/api/src/api/services/regulation.py`
- `apps/api/src/api/services/document.py`
- `apps/api/src/api/routers/regulations.py`
- `apps/api/src/api/routers/documents.py`
- `apps/web/src/app/regulations/`
- `apps/web/src/lib/types.ts`

驗收條件：
- 主令公文未發布時，公開法規查詢不可顯示「現行有效」。
- 主席點一鍵公布後，能看到已發布主令公文與有效法規版本。
- 任一步驟失敗時不可產生半有效狀態。

注意：這是 schema 與狀態機變更，需要 Alembic migration，前端型別也需同步更新 `apps/web/src/lib/types.ts`。

### P0-2 草案、修正案與版本 lineage 混亂

問題：修正草案覆蓋原草案與流程紀錄，v2/v3/v4 消失或都導向 v5，歷程出現大量廢稿。

影響：法規版本不可追溯，審議歷程被洗掉，會破壞制度信任。

建議修法：
- 區分 `regulation_id`、`version_id`、`draft_id`、`amendment_id`。
- 修正案應建立 branch，不可覆蓋主版本或原始草案。
- 每次送審、退回、通過、公布都應保留不可變事件紀錄。
- 已送審案件不得再被編輯；修正應另開新 draft/amendment。

可能檔案：
- `apps/api/src/api/models/regulation.py`
- `apps/api/src/api/services/regulation.py`
- `apps/api/src/api/routers/regulations.py`
- `apps/web/src/app/regulations/[id]/`
- `apps/web/src/components/regulations/`
- `apps/web/src/lib/types.ts`

驗收條件：
- 修正案不會覆蓋原草案與審議紀錄。
- 每個公開版本連結會進入自己的版本內容，不會全部導向最新版本。
- 已送審草案 UI 不提供可編輯操作，後端也拒絕儲存。
- 退回再送審不會建立無法辨識的大量廢稿。

注意：這通常需要資料表欄位或關聯調整，需要 Alembic migration。

### P0-3 共用 Modal/Dialog 捲動與定位錯誤

問題：多處 popup 固定出現在頁面最上方，內容過長時不可捲動，使用者必須手動滑回頂端或被迫取消。

已觀察入口：
- `apps/web/src/components/ui/Modal.tsx` 目前外層為 `fixed inset-0 flex items-center justify-center p-4`。
- 內層 modal 沒有 `max-height`、`overflow-y-auto` 與穩定的 mobile bottom sheet 策略。
- 部分頁面自寫 modal，未統一使用共用元件，例如 meal/vendor 等。

建議修法：
- 共用 Modal 外層改成支援 viewport 內捲動。
- 內容容器加上 `max-h-[calc(100vh-2rem)] overflow-y-auto`。
- modal 開啟時聚焦標題或第一個可操作元素，不改變主頁 scroll 位置。
- 將自寫 modal 逐步收斂到同一個 UI 行為。

可能檔案：
- `apps/web/src/components/ui/Modal.tsx`
- `apps/web/src/app/admin/permissions/page.tsx`
- `apps/web/src/app/audit-logs/page.tsx`
- `apps/web/src/app/meal/page.tsx`
- `apps/web/src/app/meal/vendor/page.tsx`
- `apps/web/src/components/regulations/`

驗收條件：
- 在 375x667 手機 viewport 與一般桌面 viewport，所有 modal 都能看到標題、內容與底部操作按鈕。
- 長內容 modal 可在 modal 內部捲動，背景不影響操作。
- 點擊法條編輯、log 詳細資訊、權限新增時，不需要回到頁面頂端。

### P0-4 Google 登入覆蓋手動名稱

問題：使用者在 profile 手動改名後，下次用不同瀏覽器登入又被 Google profile 名稱覆蓋。

已觀察入口：
- `apps/api/src/api/routers/auth.py` 的 Google callback 在既有 user 分支中執行 `user.display_name = display_name`。

建議修法：
- 新增 `profile_name_locked` 或 `allow_google_profile_sync` 欄位。
- 使用者手動修改 display name 後鎖定，不再由 Google login 覆蓋。
- 仍可同步 avatar 或提供「重新套用 Google 名稱」按鈕。

可能檔案：
- `apps/api/src/api/models/user.py`
- `apps/api/src/api/routers/auth.py`
- `apps/api/src/api/routers/users.py`
- `apps/web/src/app/profile/page.tsx`
- `apps/web/src/lib/types.ts`

驗收條件：
- 手動改名後，重新登入不會被 Google 名稱覆蓋。
- 新帳號第一次登入仍能使用 Google 名稱初始化。

注意：需要 Alembic migration，前端型別也需同步更新 `apps/web/src/lib/types.ts`。

### P0-5 校內帳號限制與管理員例外

問題：一般登入不應開放非 `@hchs.hc.edu.tw` 帳號，管理員可允許 Gmail 例外。

建議修法：
- OAuth callback 只允許學校網域或設定檔中的例外 email 登入。
- 例外清單應使用現有 `SUPERUSER_EMAILS` 或新增 `LOGIN_EMAIL_ALLOWLIST`。
- 回傳清楚錯誤訊息，不建立未授權 user。

可能檔案：
- `apps/api/src/api/core/config.py`
- `apps/api/src/api/routers/auth.py`
- `.env.example`

驗收條件：
- 非學校網域、非例外 email 無法登入。
- `SUPERUSER_EMAILS` 中的 Gmail 管理員仍可登入。
- 被拒絕登入者不會被建立帳號。

## P1 重要修復

### P1-1 Owner / Super Admin / Admin 權限邊界

問題：超管可互相移除，缺少不可移除的 Owner。

建議修法：
- 新增 Owner 概念，至少一位 Owner 不可被降權或移除。
- Super Admin 不可修改 Owner，Admin 不可修改 Super Admin。
- 權限 UI 清楚區分「職位授權」與「個人例外權限」。

可能檔案：
- `apps/api/src/api/models/user.py`
- `apps/api/src/api/routers/admin.py`
- `apps/api/src/api/services/permission.py`
- `apps/web/src/app/admin/permissions/page.tsx`

### P1-2 超管無組織導致問卷、學餐、商家卡住

問題：超管不屬於任何組織時，問卷無法取得組織，學餐與商家後台也無法新增或檢視。

建議修法：
- 後端 service 不應把 superuser 強制綁定單一 org。
- 需要 org context 的建立流程，應讓 superuser 明確選擇代理組織。
- 前端表單提供組織 selectable dropdown。

可能檔案：
- `apps/api/src/api/services/org.py`
- `apps/api/src/api/services/survey.py`
- `apps/api/src/api/services/meal.py`
- `apps/api/src/api/services/shop.py`
- `apps/web/src/app/surveys/new/page.tsx`
- `apps/web/src/app/meal/vendor/page.tsx`
- `apps/web/src/app/shop/admin/page.tsx`

### P1-3 API 無法連線

問題：問卷填答、學餐、商家系統出現「無法連接至後台 api」。

建議修法：
- 檢查 `apps/web/src/lib/api.ts` 的 base URL、cookie/credential、錯誤處理。
- 驗證對應 router 是否掛載。
- 將網路錯誤、401、403、500 區分顯示。

可能檔案：
- `apps/web/src/lib/api.ts`
- `apps/api/src/api/routers/survey.py`
- `apps/api/src/api/routers/meal.py`
- `apps/api/src/api/routers/shop.py`

### P1-4 `[object Object]` 錯誤訊息

問題：新增商品、商家時 toast 直接顯示 `[object Object]`。

建議修法：
- 統一前端錯誤序列化，避免 `toast.error(error)`。
- API wrapper 將 FastAPI validation errors 整理成可讀訊息。

可能檔案：
- `apps/web/src/lib/api.ts`
- `apps/web/src/app/shop/admin/page.tsx`
- `apps/web/src/app/meal/vendor/page.tsx`

驗收條件：
- 表單錯誤顯示明確欄位與原因。
- 不再出現 `[object Object]`。

### P1-5 公文權限與發布流程

問題：
- 超管看不到其他超管公文。
- 法規公布後仍要到公文系統手動「逕行發布公文」。
- 主席發布時需手打修正內容。

建議修法：
- `document:admin` 或 `admin:all` 應可檢視所有公文。
- 法規公布流程自動生成修正內容摘要。
- 主席一鍵發布主令公文，與 P0-1 狀態機合併處理。

可能檔案：
- `apps/api/src/api/routers/documents.py`
- `apps/api/src/api/services/document.py`
- `apps/api/src/api/services/regulation.py`
- `apps/web/src/app/documents/`
- `apps/web/src/app/regulations/`

## P2 可用性與體驗

### P2-1 法條編輯器 UX

問題：
- 法條檢視不直觀。
- 條文編輯區太小。
- Tab 降級不會自動轉「項」。
- 新增至尾部插錯位置。
- 拖曳排序只能拉到最上面，不能微調上下。

建議修法：
- 法條主體提前露出並加強層級視覺。
- 編輯器提高預設高度，或改雙欄/全螢幕編輯。
- 新增上下移動按鈕。
- Tab/Shift+Tab 對應層級轉換時同步更新法條類型。
- 修正 append target 的定位邏輯。

可能檔案：
- `apps/web/src/components/regulations/LawTreeEditor.tsx`
- `apps/web/src/components/regulations/RegulationEditParts.tsx`
- `apps/web/src/components/regulations/AmendmentDraftParts.tsx`

### P2-2 Toggle、Dropdown 與搜尋元件

問題：
- 顯示草稿 toggle CSS 爆掉。
- 權限 dropdown 造成畫面 overflow。
- 稽核使用者搜尋應改 selectable dropdown。
- 公文受文者可做開放式選單。

建議修法：
- 建立共用 combobox/selectable dropdown。
- Toggle 使用固定尺寸與 `overflow-hidden`。
- 權限 modal 的 dropdown 改 virtualized 或 max-height scroll list。

可能檔案：
- `apps/web/src/app/public/regulations/page.tsx`
- `apps/web/src/app/admin/permissions/page.tsx`
- `apps/web/src/app/audit-logs/page.tsx`
- `apps/web/src/app/documents/new/page.tsx`

### P2-3 2FA QRCode

問題：TOTP 功能可用，但只能手動輸入 key，對一般同學不友善。

建議修法：
- 後端回傳 otpauth URI。
- 前端顯示 QRCode 與手動 key。

可能檔案：
- `apps/api/src/api/routers/users.py`
- `apps/web/src/app/settings/security/page.tsx`

### P2-4 Hydration mismatch

問題：新分頁開啟時出現 React hydration mismatch。

建議修法：
- 檢查 SSR 首次 render 是否使用 `Date.now()`、`localStorage`、`window` 或 locale date。
- 時間相對文字放到 client effect 後再渲染。

可能入口：
- `apps/web/src/app/documents/page.tsx`
- `apps/web/src/app/notifications/page.tsx`
- `apps/web/src/app/meal/page.tsx`
- `apps/web/src/app/page.tsx`

## 制度流程待確認

下列項目牽涉會內制度，需要先確認規則再實作：

- 提案是否需要連署或覆議。
- 提案機關是否可在排入議程前撤回。
- 否決後同會期是否禁止再提相同議案。
- 主席是否能退回班代大會已通過草案。
- 廢止權限由誰持有。
- 「廢止」、「封存」、「刪除」三種狀態的法律效果。

## 建議修復順序

1. 共用 Modal 捲動修復，解除大量 UI 卡死。
2. Google 名稱覆蓋與校內帳號限制，處理登入安全與資料覆蓋。
3. `[object Object]` 與 API 錯誤訊息，讓後續 QA 能看懂失敗原因。
4. 公文 admin 可見性與 superuser org context。
5. 法規發布狀態機與版本 lineage 重構，這塊需要 migration 與回歸測試，應獨立分支處理。

## 建議測試案例

- 非 `@hchs.hc.edu.tw` 且非 allowlist 帳號登入應被拒絕。
- 手動改名後重新 Google 登入不覆蓋名稱。
- 375x667 viewport 開啟權限新增、法條編輯、log 詳細資訊皆可完整操作。
- 已送審草案前端不可編輯，後端 PATCH/PUT 也拒絕。
- 修正案送審不覆蓋原草案與流程紀錄。
- 主令公文未發布時法規不可顯示現行有效。
- 廢止法規仍可從歷史/封存查詢，不從系統消失。
- 商品與商家新增失敗時顯示可讀錯誤，而不是 `[object Object]`。
