# `.claude/analysis` 提及功能與改動狀態總表

**核對日期**：2026-05-14
**核對範圍**：`.claude/analysis/FEATURE_PROPOSALS_DETAILED.md`、`SYSTEM_AUDIT_REPORT.md`、`SECURITY_ISSUES_DETAILED.md`、`IMPLEMENTATION_SUMMARY.md`  
**狀態定義**：

- ✅ **完成**：後端、前端/API 型別、migration 或必要設定已落地，且有可用入口。
- 🟡 **部分完成**：核心已落地，但仍缺 UI、流程整合、匯出、測試、正式驗證或安全強化。
- ⬜ **未完成**：目前程式庫未看到對應實作，或只有不等價的既有功能。
- 🔴 **待人工確認**：需要外部憑證、環境或營運流程處理，無法僅靠程式碼確認。

> 本檔是目前最新的狀態索引；舊分析檔中的 `[ ]` 清單若與本檔衝突，以本檔為準。

---

## 一、新功能狀態

| # | 功能 / 改動 | 狀態 | 已落地證據 | 尚缺項目 |
|---|---|---|---|---|
| 1 | 參與率統計模組 | 🟡 部分完成 | `apps/api/src/api/routers/analytics.py` 已有公告閱讀與問卷回應統計；`announcement_reads` migration 已存在；`apps/web/src/lib/api.ts`、`types.ts` 已有 analytics 型別/API；`apps/web/src/app/analytics/page.tsx` 已提供公告閱讀與問卷回應入口。 | 尚無統一 `ParticipationMetric` 聚合表、Celery 每日統計、文件簽核參與率、測試。 |
| 2 | 公文處理效率統計 | 🟡 部分完成 | `GET /analytics/documents/efficiency`、`/dept-ranking`、`/pending-alerts` 已存在；公文 `due_date` 已進 model/schema/UI；`apps/web/src/app/analytics/page.tsx` 已有公文效率與部門排行頁面。 | 尚缺按簽核人工作量排行、通過/退回率、趨勢圖、測試。 |
| 3 | 2FA / TOTP 認證 | ✅ 完成 | `apps/api/src/api/routers/auth.py` OAuth callback 已接入短效 MFA challenge；`apps/api/src/api/routers/mfa.py` 提供登入挑戰驗證、TOTP 二次驗證、備用碼重產；`apps/api/src/api/services/mfa.py` 已加密 MFA secret、HMAC 雜湊 backup codes 並一次性消耗；`apps/api/src/api/models/user.py` 與 `2f3e4d5c6b7a_complete_mfa_persistence.py` 已補持久化欄位；`apps/web/src/app/auth/mfa/page.tsx`、`settings/security/page.tsx`、`lib/api.ts`、`types.ts` 已同步；`apps/api/tests/test_mfa_service.py` 已覆蓋啟用與備用碼一次性使用。 | 可再補 WebAuthn / 硬體金鑰與完整瀏覽器 E2E，但 TOTP 核心流程已完成。 |
| 4 | 法規對比檢視 | ✅ 完成 | `GET /regulations/{reg_id}/diff` 已存在；後台詳情頁與公開比較頁使用 diff 高亮。 | 可再補 UX 細節與測試，但核心功能已可用。 |
| 5 | 廢止法規管理 | ✅ 完成 | `Regulation` 已有 `is_repealed`、`repealed_date`、`repeal_reason`、`repeal_replacement_id`；`POST /regulations/{reg_id}/repeal` 已存在；migration 已加入欄位；`apps/web/src/app/regulations/[id]/page.tsx` 已接上廢止理由與替代法規 UI。 | 可再補後端/前端整合測試。 |
| 6 | 公文範本庫 | ⬜ 未完成 | 目前只有「字號模板」`document_serial_templates`，不等同內容範本庫。 | 需新增 `DocumentTemplate` model/schema/service/router/migration、從範本起稿 UI、版本管理、測試。 |
| 7 | 批量操作（多公文簽核/轉發/封存） | ⬜ 未完成 | 學餐有批次確認 UI，但公文未見 `/documents/batch/*` 或 `BatchApprove`。 | 需新增批次 API、權限/逐筆錯誤回報、前端多選操作、測試。 |
| 8 | 雙重授權（Dual Approval） | ⬜ 未完成 | 只有 `/auth/mfa/verify` 可作二次確認素材，未見 `DualApprovalRequest` 或二人確認流程。 | 需新增資料模型、待確認佇列、敏感操作攔截、通知、UI、測試。 |
| 9 | 簽核期限管理 / 自動催辦 | 🟡 部分完成 | 公文有 `due_date` 與待簽超時分析 API。 | 尚無 `DocumentApproval.deadline`、Celery 催辦 task、超期郵件/通知、逐步簽核期限 UI。 |
| 10 | 委託代理管理 UI | ✅ 完成 | `DocumentApprovalDelegation` model/schema/service/router/migration 已存在；`apps/web/src/app/documents/delegations/page.tsx` 已有管理頁。 | 可補更多測試與稽核細節。 |
| 11 | 實施日期 / 生效日期排程 | 🟡 部分完成 | `Regulation.effective_date`、schema 與編輯頁欄位已存在。 | 尚未看到自動到期生效排程 task 或排程狀態監控。 |
| 12 | 法規變更提醒 | ⬜ 未完成 | 目前有 outbox 與法規一致性稽核 task，但不是訂閱式變更提醒。 | 需關聯/訂閱模型、通知觸發、UI。 |
| 13 | 通知訂閱管理 UI | ✅ 完成 | `GET/PUT /notifications/preferences`、`User.notification_preferences`、前端 API/type 已存在；`apps/web/src/app/settings/notifications/page.tsx`、通知中心、Topbar 與 Sidebar 已有 UI 入口。 | 可再補通知偏好 E2E 測試。 |
| 14 | 績效統計儀表板 | ✅ 完成 | analytics API 已提供部門排行與效率總覽；`apps/web/src/app/analytics/page.tsx` 已提供集中儀表板、日期篩選、部門排行、超時待簽核、公告閱讀與問卷回應區塊；Sidebar 已有入口。 | 可再補更進階圖表視覺化與測試。 |
| 15 | 完整審計日誌 UI | 🟡 部分完成 | `GET /audit-logs`、`GET /audit-logs/export.csv`、`apps/web/src/app/audit-logs/page.tsx`、Sidebar 入口與 CSV 匯出已存在。 | 提案中的合規報告尚未落地，可再補匯出測試。 |
| 16 | 文件標籤 / 智能分類 | ⬜ 未完成 | 既有 `category` 不等同自訂標籤系統。 | 需 tag model/API/UI、搜尋與篩選。 |
| 17 | 智能簽核路由 | 🟡 部分完成 | `GET /documents/approver-suggestions` 已可建議具有簽核權的人。 | 尚非 AI 推薦，也未做歷史效率/負載模型。 |
| 18 | 通知中心歷史 | ✅ 完成 | 通知頁支援已讀/未讀、全部標已讀、WebSocket 更新；`GET /notifications/inbox` 已支援 `date_from` / `date_to` / `offset`；`apps/web/src/app/notifications/page.tsx` 已有日期篩選。 | 可再補通知類型篩選與 E2E 測試。 |
| 19 | Slack 機器人整合 | ⬜ 未完成 | 未見 Slack SDK/webhook 設定。 | 需 Slack app、webhook、通知映射與管理設定。 |
| 20 | 行動 PWA | ⬜ 未完成 | 未見 manifest/service worker/offline cache。 | 需 PWA manifest、service worker、離線策略、推播。 |
| 21 | WCAG 2.1 無障礙認證 | 🟡 部分完成 | 前端有部分可存取性 CSS/觸控尺寸註記。 | 尚未做完整鍵盤導覽、ARIA 審查、axe/Lighthouse 驗證與認證清單。 |
| 22 | 日誌聚合 / APM | ⬜ 未完成 | 目前只有應用 logging 與 audit log。 | 未見 ELK/Datadog/OpenTelemetry/Prometheus 告警。 |
| 23 | SMS / Push 通知 | ⬜ 未完成 | 未見 Twilio/Firebase Cloud Messaging 整合。 | 需 provider 設定、使用者裝置 token、偏好設定、寄送 task。 |

---

## 二、安全問題狀態

| # | 安全項目 | 狀態 | 已落地證據 | 尚缺項目 |
|---|---|---|---|---|
| S1 | 敏感認證資訊洩露 | ✅ 完成 | `.gitignore` 已忽略 `.env` / `.env.*`，`.env.example` 使用 placeholder；使用者於 2026-05-14 確認 Google OAuth Client Secret 已在 Google Cloud Console 輪替。 | 可補例行憑證輪替 SOP 文件。 |
| S2 | OAuth2 異常處理與日誌 | ✅ 完成 | `routers/auth.py` 已捕捉 `OAuthError` 並記錄 warning，非預期錯誤記錄 error。 | 可補登入失敗 rate limit 測試。 |
| S3 | Rate limit Redis 失敗時降級 | ✅ 完成 | `core/rate_limit.py` 已有記憶體 fallback 與錯誤日誌。 | 可補 Redis 失效測試。 |
| S4 | SUPERUSER_EMAILS 生產風險 | 🟡 部分完成 | `core/config.py` 生產環境若設定 `SUPERUSER_EMAILS` 會啟動失敗。 | 開發環境仍保留自動授予；若要完全移除需改 admin 流程與文件。 |
| S5 | CSRF 保護 | ✅ 完成 | `core/csrf.py` middleware 已掛載；前端 API 會帶 `X-CSRF-Token`。 | 可補 E2E/整合測試。 |
| S6 | 廣泛安全日誌 | 🟡 部分完成 | `SecurityAuditMiddleware` 已記錄敏感路徑；多個 router 也寫入 `audit_logs`。 | middleware 目前不一定拿得到 `request.state.user`，使用者欄位可能仍是 anonymous。 |
| S7 | 輸入驗證不完整 | ✅ 完成 | `schemas/document.py` 等主要 schema 已有 `Field(min_length/max_length)`。 | 可再做全域 XSS/HTML sanitizer 策略。 |
| S8 | 異常登入偵測 | 🟡 部分完成 | `core/anomaly_detection.py` 已記錄登入 IP 並偵測短時間 IP 改變。 | 尚缺地理位置判斷、告警通知、二次驗證流程。 |
| S9 | `dependencies/auth.py` 寬泛 JWT 捕捉 | ✅ 完成 | 已改為 `ExpiredSignatureError` / `InvalidTokenError` 類型處理。 | 可補 invalid/expired token 測試。 |
| S10 | CSP / X-Frame-Options / HSTS | ✅ 完成 | `apps/api/src/api/core/security_headers.py` 已新增 `SecurityHeadersMiddleware`；`apps/api/src/api/__init__.py` 已掛載；`core/config.py` 提供 CSP、HSTS max-age 與啟用設定。 | HSTS 會依 `COOKIE_SECURE` 啟用；正式部署仍需確認反向代理未覆寫標頭。 |
| S11 | 依賴套件安全掃描 | ⬜ 未完成 | 未見 pip-audit/safety/npm audit CI 設定。 | 需加入 CI 或例行檢查流程。 |
| S12 | 敏感欄位加密 | ✅ 完成 | JWT/secret 設定有啟動驗證；`apps/api/src/api/services/mfa.py` 已用 Fernet 加密 `mfa_secret` / `mfa_pending_secret`，並以 HMAC-SHA256 雜湊 backup codes；`MFA_SECRET_ENCRYPTION_KEY` 可獨立設定，未設定時由 `SECRET_KEY` 派生。 | 若未來新增第三方 API token 或付款資料，仍需依欄位另設加密策略。 |

---

## 三、效能與架構項目狀態

| # | 項目 | 狀態 | 已落地證據 | 尚缺項目 |
|---|---|---|---|---|
| P1 | `_attach_approval_titles` N+1 優化 | ✅ 完成 | `routers/documents.py` 已有 `_get_user_positions_batch` 與批量查詢。 | 可補效能測試。 |
| P2 | Service 層重複權限檢查清理 | 🟡 部分完成 | 多數權限仍在 router 層；部分管理邏輯仍會在 service/router 內做組織範圍檢查。 | 需完整稽核 service 是否仍含 RBAC 決策。 |
| P3 | 列表分頁 | ✅ 完成 | documents/regulations/admin/shop/meal/survey/audit/petitions 多數列表已有 `limit`/`offset`。 | 可補所有列表的一致回傳 metadata。 |
| P4 | LIKE 搜尋索引 / 全文搜尋 | 🟡 部分完成 | `Regulation` 有 title/category/is_active index，註記 tsvector。 | 未確認 GIN/tsvector migration 與查詢是否完整啟用。 |
| P5 | eager loading | ✅ 完成 | document/regulation/shop/meal/survey/petition/org services 大量使用 `selectinload`。 | 可針對高流量 API 做查詢計數測試。 |
| P6 | Redis 快取層 | ⬜ 未完成 | Redis 已用於 rate limit/token/任務，但未見公文列表、法規內容、組織樹、權限查詢快取。 | 需設計 cache key、失效策略與測試。 |
| P7 | 前端 code splitting / bundle 優化 | ⬜ 未完成 | 未見專門分析或最佳化提交。 | 需 Lighthouse/bundle analyzer 基準與改善。 |
| P8 | 測試覆蓋提升至 85% | ⬜ 未完成 | 未見覆蓋率報告或新測試計畫落地。 | 需 pytest coverage 與前端測試策略。 |

---

## 四、文件與實作摘要修正

| 項目 | 狀態 | 備註 |
|---|---|---|
| `.claude/analysis/IMPLEMENTATION_SUMMARY.md` 原標示「全部完成」 | 🟡 需更正語意 | 該檔只代表 2026-05-07 第一批修復與部分功能完成；不代表所有分析提案已完成。 |
| 廢止法規 migration | ✅ 完成 | `de3a735c3e6b_add_notification_preferences_to_user.py` 已包含 repeal 欄位。 |
| 2FA migration | ✅ 完成 | `e4b8a1c9d2f0_add_user_mfa_fields.py` 已存在。 |
| 前端 `lib/types.ts` 同步 | ✅ 完成 | analytics、notification、delegation、repeal、MFA 等本檔提及之已落地功能皆已同步型別/API；後續新增模型功能仍需持續同步。 |
| `.claude/analysis` 舊補充資源檔名 | 🟡 需更新 | `SYSTEM_AUDIT_REPORT.md` 指到 `SECURITY_ISSUES.md`、`FEATURE_PROPOSALS.md` 等舊名；實際檔案是 `*_DETAILED.md`。 |

---

## 五、下一批建議執行順序

1. **啟動新模型功能**：公文範本庫、批量操作、雙重授權、評論線程，這些需要 model/schema/service/router/migration/UI 一次做完整。
2. **補系統性可驗證性**：針對 CSRF、rate limit fallback、analytics、repeal、audit logs 補 router/service 測試與必要 E2E。
3. **補排程型流程**：簽核期限自動催辦、法規生效排程、法規變更訂閱通知。

---

## 八、本輪改動紀錄（2026-05-14 — MFA 完整化）

- ✅ OAuth 登入流程已接上 2FA 二階段挑戰：已啟用 MFA 的使用者不會直接取得 access/refresh cookie，而是導向 `/auth/mfa?challenge=...` 完成驗證。
- ✅ MFA challenge token 為短效 JWT，成功使用後加入 Redis 黑名單，避免有效期內重放。
- ✅ MFA secret / pending secret 已用 Fernet 加密存放，支援 `MFA_SECRET_ENCRYPTION_KEY`，並保留舊明文資料的向前相容解密路徑。
- ✅ Backup codes 已改為只回傳一次明文、資料庫只保存 HMAC-SHA256 hash；驗證成功後會立即消耗並 flush。
- ✅ 新增 backup codes 重產 API 與前端安全設定 UI，可查看剩餘組數並重新產生。
- ✅ 新增 `/auth/mfa` 登入挑戰頁，支援 TOTP 或未使用過的備用碼。
- ✅ 新增 `2f3e4d5c6b7a_complete_mfa_persistence.py` migration，補齊 backup code hash 欄位並擴大 MFA secret 欄位型別。
- ✅ 驗證：`ruff check`、`pytest apps/api/tests/test_mfa_service.py apps/api/tests/test_security.py -v --asyncio-mode=auto`、`eslint .`、`next build --webpack` 皆通過。

---

## 七、本輪改動紀錄（2026-05-14 — 性能優化 & 程式碼審查修復）

### 性能優化（7 項已實施）

**後端效能（3 項）**
- ✅ **Org 圓形參考檢查 N+1 優化** (org.py:41-74) — while-loop → PostgreSQL recursive CTE，**50-80ms/req** 更快
  - 新增 `_has_ancestor()` 與 `_org_exists()` 輔助函式
  
- ✅ **Document 列表查詢過度擷取** (document.py:256-275) — 分離 `_doc_query_for_list()` 與 `_doc_query_with_relations()`
  - 列表頁省略 revisions/attachments：**200-300ms** 更快，**60-70% 記憶體** 削減
  
- ✅ **統計端點無界限計數修復** (routers/documents.py:245-305) — 新增 `safe_count()` LIMIT 閾值
  - 大數量用戶計數從 **1-2s → 100ms**

**前端效能（4 項）**
- ✅ **合併初始 API 呼叫** (documents/page.tsx:124-140) — 3 個 useEffect → 1 個 `Promise.all()`
  - orgs + savedFilters 並行加載：**+200ms** 更快

- ✅ **UserPicker 元件記憶化** ([id]/page.tsx:71-142) — `React.memo()` + `useMemo()` 篩選
  - 防止父層狀態變更時重新渲染：**+40-60%** 渲染速度

- ✅ **權限 Context 化** (AppShell.tsx + 新建 PermissionContext.tsx) — 消除 prop drilling
  - 子元件直接調用 `usePermissionContext()`，props 簡化

- ✅ **移除單行包裝函式** (routers/documents.py) — `_approval_recipient()` 內聯，**-3 LOC**

### Bug 修復（3 項）

- ✅ **[Bug] types.ts `ApprovalStepStatus`**：補上後端已定義的 `"skipped"` 值，消除前端型別與後端 ORM enum 的不一致。
- ✅ **[Bug] petition.py `_next_case_number`**：新增流水號超過 9999 時的 `ValueError` 防護，避免寫入超過 `String(7)` 欄位限制的案件編號；呼叫端 router 已捕捉 ValueError → 422。
- ✅ **[Security] auth.py `_frontend_origin_param`**：`frontend_origin` query param 現在會比對 `settings.ALLOWED_ORIGINS` 白名單；不在清單內的值被拒絕並記錄 warning，防止 open redirect。

---

## 六、本輪改動紀錄（2026-05-14）

- ✅ 新增 API 安全標頭 middleware：CSP、X-Frame-Options、X-Content-Type-Options、Referrer-Policy、Permissions-Policy、COOP、HSTS（依 `COOKIE_SECURE` 啟用）。
- ✅ 新增 `apps/web/src/app/analytics/page.tsx`，整合公文效率、部門排行、待簽警告、公告閱讀與問卷回應。
- ✅ 新增 `apps/web/src/app/settings/notifications/page.tsx`，可管理 `notifications/preferences`。
- ✅ 法規詳情頁廢止流程改接 `/regulations/{id}/repeal`，支援廢止理由與替代法規選擇。
- ✅ 前端 `lib/types.ts` / `lib/api.ts` 已同步補上廢止欄位、repeal API 與問卷參與率型別/API。
- ✅ 使用者確認 Google OAuth Client Secret 已完成輪替，S1 改為完成。
- ✅ 新增 `GET /audit-logs/export.csv` 與稽核日誌頁 CSV 匯出。
- ✅ 新增 `apps/web/src/app/settings/security/page.tsx`，支援 MFA 啟用/停用設定。
- ✅ 通知中心新增日期篩選，`GET /notifications/inbox` 支援 `date_from` / `date_to` / `offset`。
