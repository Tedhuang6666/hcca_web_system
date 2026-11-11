# 2026-11-11 事件報告處置

來源：使用者提供的 `incident_report_2026-11-11.csv`，75 筆資料包含 25 筆事件與
50 筆慢查詢觀測。以下資料列編號不含標題列。本紀錄不收錄 IP、完整 UA、使用者資料或原始堆疊。

## 判讀與修改

| 資料列 | 判讀 | 處置與驗收 |
| --- | --- | --- |
| 21 | 優惠異動重算外部表單訂單時，`order.user` 可為空，舊版會產生 `AttributeError`。 | 目前 HEAD 已在兩個優惠資格檢查使用空值防護。實跑既有 `test_promotion_changes_include_external_orders_but_keep_identity_restrictions`，確認無帳號訂單可重算通用優惠，且不取得限定帳號／學號或優惠碼的優惠。 |
| 1、13、20 | 圖片載入失敗；其中有 HEAD 200、`naturalWidth=0`，不能因 HTTP 成功就判定圖片正常。 | 修正公開 `/shop/<數字>/<圖片檔名>` 仍進入頁面維護／封鎖檢查的路徑，避免圖片收到 HTML 重新導向並減少額外 API 呼叫。已從 DOM 移除的圖片在探測前後都不再回報。仍連接 DOM 的解碼失敗繼續回報，包括 HEAD 200。這是修正可重現的路徑問題，尚不能證明所有歷史圖片錯誤的根因相同。 |
| 3、18 | 優惠預覽 POST 的網路失敗／逾時，缺乏足以判定伺服器原因的證據。 | 保留事件與既有 request trace、耗時、階段等診斷。背景逾時規則不排除 POST 或其他寫入。 |
| 4、5、8–12、14、15、17、19、22、24、25 | API 讀取的網路失敗／逾時；部分紀錄結束時頁面隱藏，單憑此欄位不足以證明誤報。 | 僅對有完整背景停留或長時間背景暫停證據的 GET／HEAD 逾時，保留近期錯誤紀錄而不建立持久事件；缺欄位、前景逾時、曾在前景等待完整 timeout、一般網路失敗仍建立事件。 |
| 6、7、23 | 舊版 Next.js chunk／CSS 載入失敗。 | 保留既有單次快取清理／重新載入與冷卻防護；未恢復的錯誤繼續回報。沒有正式環境資源狀態，不能宣告全數修復。 |
| 2、16 | 實際 CSP enforce 阻擋（media data、inline style）；沒有足夠應用來源證據判定是否為瀏覽器注入。 | 保留既有 enforce 事件與 CSP 政策，不為消除告警放寬政策。report-only、已知外部注入的既有過濾照舊。 |
| 所有 regression | 23 筆都帶有先前「24 小時未觀測到」的自動結案說明。靜默不等於已驗證修復。 | 自動結案後再發生改為 OPEN／`reopened`；人工或已知修復結案後仍為 REGRESSION／`regressed`。重開時清除目前的舊結案說明與時間，歷史結案事件保留。既有資料不批次改寫。 |
| 26–75 | 慢查詢觀測，50 個樣本最大值約 72.7–943.5ms。 | 既有量測為 `sqlalchemy_cursor_wall_time`，包含驅動、網路與排程等待；快照無 PostgreSQL execution plan，不能當成 50 個 SQL 缺陷或直接加索引。重複較多的 `/shop/close-status`、使用者／session 查詢應以 trace 對照伺服器與 DB 時間後再定位。保留量測與門檻，不提高門檻掩蓋問題。 |

新規則只影響往後接收的事件。歷史事件、正式資料、部署均未變更。

## 驗證

- 定向前端測試：`src/proxy.test.ts`、`src/lib/client-error-reporter.test.ts`，34 個通過。
- 完整 Web lint、module registry、type-check 通過；Vitest coverage 共 134 個檔案、
  793 個測試通過。ESLint 保留 8 個非本次檔案的既有 warning。
- 後端補充測試：`test_incident.py`、`test_incident_report_regressions.py` 與上述無帳號訂單
  案例，44 個通過；使用真實記憶體 SQLite，沒有 mock DB。
- `bash scripts/check.sh api` 通過：Ruff、format、mypy 10 個 gate 模組、queue 拓撲、
  Gunicorn 本機 socket 測試 3 個。新增測試檔另通過 Ruff。
- 最後調整同交易事件時間戳記相同時的排序後，重跑新增的 14 個後端回歸，全部通過。
  另跑既有 `test_cleanup_keeps_regression_detection`，1 個通過，確認已知修復結案仍能偵測復發。
- 兩個報告中的 WebP 檔案可在本機以 Pillow 完整解碼；這只證明目前檔案有效，
  不代表歷史網路回應或所有瀏覽器都已驗證。
- 標準 `api-test` 未通過環境前置檢查：沒有設定合規的 `TEST_DATABASE_URL`，本機
  5432／6379 不可達。SQLite 結果不能代替 PostgreSQL 或 migration 驗證。

- GitNexus impact：`upsert_incident` 直接呼叫者為 `persist_error_incident` 與
  `_persist_background_incident`；`persist_client_error_incident` 為公開回報 router；
  `publicAssetCacheControl` 為 `proxy`；全域 reporter 為 provider，既有符號均回報 LOW。
  提交前 CLI detect-changes 與 MCP 完整結果均已檢查，無 partial／truncated。
  整個工作樹 HIGH 的 11 條流程都屬於另一項 `CouncilOrdersPage` 修改，本次不提交。
  其他來源完成處室排序提交後，本次 7 個暫存檔另做 staged 分析為 LOW，無 partial／truncated。
  原生索引重建曾中止、遇到暫存 CSV 衝突與其他更新鎖，未完成刷新；新 helper／新測試的
  圖譜覆蓋仍為 UNKNOWN，不能以既有圖譜宣稱零影響，已補文字引用與實跑回歸。
- 標準 Web 首次檢查停在 production build：同工作樹另一個 build 持有輸出鎖。
  隔離副本曾通過編譯及型別，但漏帶根目錄字型而在 OG 頁面產生失敗；補字型後工作階段中斷，
  該次結果不計通過。最後在原工作樹重新執行 `npm run --prefix apps/web build`，exit 0，
  完整通過正式編譯、TypeScript、靜態頁面產生；未刪其他人的鎖或停止其他程序。
- `bash scripts/check.sh docs`、`git diff --check` 與暫存差異格式檢查通過。
