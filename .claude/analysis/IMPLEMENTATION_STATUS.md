# `.claude/analysis` 提及功能與改動狀態總表

**核對日期**：2026-05-13  
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
| 1 | 參與率統計模組 | 🟡 部分完成 | `apps/api/src/api/routers/analytics.py` 已有公告閱讀與問卷回應統計；`announcement_reads` migration 已存在；`apps/web/src/lib/api.ts`、`types.ts` 已有 analytics 型別/API。 | 尚無統一 `ParticipationMetric` 聚合表、Celery 每日統計、前端圖表頁、文件簽核參與率、測試。 |
| 2 | 公文處理效率統計 | 🟡 部分完成 | `GET /analytics/documents/efficiency`、`/dept-ranking`、`/pending-alerts` 已存在；公文 `due_date` 已進 model/schema/UI。 | 尚缺按簽核人工作量排行、通過/退回率、趨勢圖 UI、測試。 |
| 3 | 2FA / TOTP 認證 | 🟡 部分完成 | `apps/api/src/api/routers/mfa.py`、`services/mfa.py`、`models/user.py` MFA 欄位、`pyotp` 依賴、`e4b8a1c9d2f0_add_user_mfa_fields.py` migration 已存在。 | 尚缺前端設定頁、登入流程完整二階段挑戰、backup codes 持久化/雜湊、MFA secret 加密、測試。 |
| 4 | 法規對比檢視 | ✅ 完成 | `GET /regulations/{reg_id}/diff` 已存在；後台詳情頁與公開比較頁使用 diff 高亮。 | 可再補 UX 細節與測試，但核心功能已可用。 |
| 5 | 廢止法規管理 | 🟡 部分完成 | `Regulation` 已有 `is_repealed`、`repealed_date`、`repeal_reason`、`repeal_replacement_id`；`POST /regulations/{reg_id}/repeal` 已存在；migration 已加入欄位。 | 前端目前主要走 `/archive`，尚未完整接上 `/repeal` 的理由與替代法規 UI；需補測試。 |
| 6 | 公文範本庫 | ⬜ 未完成 | 目前只有「字號模板」`document_serial_templates`，不等同內容範本庫。 | 需新增 `DocumentTemplate` model/schema/service/router/migration、從範本起稿 UI、版本管理、測試。 |
| 7 | 批量操作（多公文簽核/轉發/封存） | ⬜ 未完成 | 學餐有批次確認 UI，但公文未見 `/documents/batch/*` 或 `BatchApprove`。 | 需新增批次 API、權限/逐筆錯誤回報、前端多選操作、測試。 |
| 8 | 雙重授權（Dual Approval） | ⬜ 未完成 | 只有 `/auth/mfa/verify` 可作二次確認素材，未見 `DualApprovalRequest` 或二人確認流程。 | 需新增資料模型、待確認佇列、敏感操作攔截、通知、UI、測試。 |
| 9 | 簽核期限管理 / 自動催辦 | 🟡 部分完成 | 公文有 `due_date` 與待簽超時分析 API。 | 尚無 `DocumentApproval.deadline`、Celery 催辦 task、超期郵件/通知、逐步簽核期限 UI。 |
| 10 | 委託代理管理 UI | ✅ 完成 | `DocumentApprovalDelegation` model/schema/service/router/migration 已存在；`apps/web/src/app/documents/delegations/page.tsx` 已有管理頁。 | 可補更多測試與稽核細節。 |
| 11 | 實施日期 / 生效日期排程 | 🟡 部分完成 | `Regulation.effective_date`、schema 與編輯頁欄位已存在。 | 尚未看到自動到期生效排程 task 或排程狀態監控。 |
| 12 | 法規變更提醒 | ⬜ 未完成 | 目前有 outbox 與法規一致性稽核 task，但不是訂閱式變更提醒。 | 需關聯/訂閱模型、通知觸發、UI。 |
| 13 | 通知訂閱管理 UI | 🟡 部分完成 | `GET/PUT /notifications/preferences`、`User.notification_preferences`、前端 API/type 已存在。 | 尚缺 `settings/notifications` 或等價 UI 入口。 |
| 14 | 績效統計儀表板 | 🟡 部分完成 | analytics API 已提供部門排行與效率總覽。 | 尚缺集中儀表板頁、圖表與導覽入口。 |
| 15 | 完整審計日誌 UI | 🟡 部分完成 | `GET /audit-logs`、`apps/web/src/app/audit-logs/page.tsx`、Sidebar 入口已存在。 | 提案中的 CSV 匯出/合規報告尚未落地。 |
| 16 | 文件標籤 / 智能分類 | ⬜ 未完成 | 既有 `category` 不等同自訂標籤系統。 | 需 tag model/API/UI、搜尋與篩選。 |
| 17 | 文件評論線程 | ⬜ 未完成 | 未見公文/法規 comment thread model 或 API。 | 需 comments model/API/UI/通知。 |
| 18 | AI 自動摘要 | ⬜ 未完成 | 修正案頁有本地摘要/提示文案，但未見 LLM API 整合。 | 需 AI service、權限/費用控制、提示詞與審計。 |
| 19 | 智能簽核路由 | 🟡 部分完成 | `GET /documents/approver-suggestions` 已可建議具有簽核權的人。 | 尚非 AI 推薦，也未做歷史效率/負載模型。 |
| 20 | 通知中心歷史 | 🟡 部分完成 | 通知頁支援已讀/未讀、全部標已讀、WebSocket 更新。 | 提案中的日期篩選/更完整歷史查詢尚未落地。 |
| 21 | Slack 機器人整合 | ⬜ 未完成 | 未見 Slack SDK/webhook 設定。 | 需 Slack app、webhook、通知映射與管理設定。 |
| 22 | 行動 PWA | ⬜ 未完成 | 未見 manifest/service worker/offline cache。 | 需 PWA manifest、service worker、離線策略、推播。 |
| 23 | WCAG 2.1 無障礙認證 | 🟡 部分完成 | 前端有部分可存取性 CSS/觸控尺寸註記。 | 尚未做完整鍵盤導覽、ARIA 審查、axe/Lighthouse 驗證與認證清單。 |
| 24 | 日誌聚合 / APM | ⬜ 未完成 | 目前只有應用 logging 與 audit log。 | 未見 ELK/Datadog/OpenTelemetry/Prometheus 告警。 |
| 25 | SMS / Push 通知 | ⬜ 未完成 | 未見 Twilio/Firebase Cloud Messaging 整合。 | 需 provider 設定、使用者裝置 token、偏好設定、寄送 task。 |

---

## 二、安全問題狀態

| # | 安全項目 | 狀態 | 已落地證據 | 尚缺項目 |
|---|---|---|---|---|
| S1 | 敏感認證資訊洩露 | 🔴 待人工確認 | `.gitignore` 已忽略 `.env` / `.env.*`，`.env.example` 使用 placeholder。 | Google OAuth Client Secret 是否已在 Google Cloud Console 輪替，需人工確認。 |
| S2 | OAuth2 異常處理與日誌 | ✅ 完成 | `routers/auth.py` 已捕捉 `OAuthError` 並記錄 warning，非預期錯誤記錄 error。 | 可補登入失敗 rate limit 測試。 |
| S3 | Rate limit Redis 失敗時降級 | ✅ 完成 | `core/rate_limit.py` 已有記憶體 fallback 與錯誤日誌。 | 可補 Redis 失效測試。 |
| S4 | SUPERUSER_EMAILS 生產風險 | 🟡 部分完成 | `core/config.py` 生產環境若設定 `SUPERUSER_EMAILS` 會啟動失敗。 | 開發環境仍保留自動授予；若要完全移除需改 admin 流程與文件。 |
| S5 | CSRF 保護 | ✅ 完成 | `core/csrf.py` middleware 已掛載；前端 API 會帶 `X-CSRF-Token`。 | 可補 E2E/整合測試。 |
| S6 | 廣泛安全日誌 | 🟡 部分完成 | `SecurityAuditMiddleware` 已記錄敏感路徑；多個 router 也寫入 `audit_logs`。 | middleware 目前不一定拿得到 `request.state.user`，使用者欄位可能仍是 anonymous。 |
| S7 | 輸入驗證不完整 | ✅ 完成 | `schemas/document.py` 等主要 schema 已有 `Field(min_length/max_length)`。 | 可再做全域 XSS/HTML sanitizer 策略。 |
| S8 | 異常登入偵測 | 🟡 部分完成 | `core/anomaly_detection.py` 已記錄登入 IP 並偵測短時間 IP 改變。 | 尚缺地理位置判斷、告警通知、二次驗證流程。 |
| S9 | `dependencies/auth.py` 寬泛 JWT 捕捉 | ✅ 完成 | 已改為 `ExpiredSignatureError` / `InvalidTokenError` 類型處理。 | 可補 invalid/expired token 測試。 |
| S10 | CSP / X-Frame-Options / HSTS | ⬜ 未完成 | 未見安全標頭 middleware。 | 需新增 response headers 或由反向代理統一設定。 |
| S11 | 依賴套件安全掃描 | ⬜ 未完成 | 未見 pip-audit/safety/npm audit CI 設定。 | 需加入 CI 或例行檢查流程。 |
| S12 | 敏感欄位加密 | 🟡 部分完成 | JWT/secret 設定有啟動驗證；MFA 已有欄位。 | `mfa_secret` 尚未加密；其他敏感欄位也未見欄位級加密策略。 |

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
| 前端 `lib/types.ts` 同步 | 🟡 部分完成 | analytics、notification、delegation 等已同步；MFA 前端型別/API 尚未有完整 UI 封裝。 |
| `.claude/analysis` 舊補充資源檔名 | 🟡 需更新 | `SYSTEM_AUDIT_REPORT.md` 指到 `SECURITY_ISSUES.md`、`FEATURE_PROPOSALS.md` 等舊名；實際檔案是 `*_DETAILED.md`。 |

---

## 五、下一批建議執行順序

1. **把已部分完成的安全項補齊**：MFA 登入流程、MFA secret 加密、backup code 持久化、security headers。
2. **補前端入口**：analytics 儀表板、通知偏好設定、廢止法規 `/repeal` UI。
3. **補可驗證性**：針對 CSRF、rate limit fallback、MFA、analytics、repeal、audit logs 補測試。
4. **再啟動新模型功能**：公文範本庫、批量操作、雙重授權、評論線程。
