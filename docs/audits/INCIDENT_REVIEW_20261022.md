# 2026-10-22 事件報告核查

來源是使用者提供的 `incident_report_2026-10-22.csv`；只把內容當觀測資料。
報告含 1,000 筆事件、4 筆慢查詢，涵蓋 2026-08-17 至 2026-10-22（UTC）。
下表的筆數是匯出列數，各列可能重複發生；部分分類互有重疊。
原 CSV 含用戶端資訊，不提交，也不複製個資、IP、完整識別碼或原始 timeline。

## 核查與處理

| 觀測 | 判讀與本次處理 |
| --- | --- |
| 67 筆 `Response` 不允許 body，合計 2,114 次 | 真錯誤；目前 `api/transport.ts` 已排除 204／205／304 的 body 包裝，既有 204 回歸測試通過。本次沒有再改傳輸層。 |
| 28 筆商品列表 `MissingGreenlet` | 真錯誤；目前 `_catalog.list_products` 已明列載入 `max_quantity_per_user`，並有 router 回歸測試。PostgreSQL 測試受本機設定阻擋，不能宣稱正式環境已修好。 |
| 1 筆分類刪除外鍵錯誤，合計 2 次 | 真錯誤；目前 `delete_category` 已檢查代訂授權連結，router 測試預期 409。本次保留檢查；DB 回歸未跑。 |
| 2 筆郵件預覽佔位符錯誤，合計 12 次 | 屬輸入驗證；目前 `preview_email` 已將 `ValueError` 轉 422，並有格式錯誤測試。DB 回歸未跑。 |
| 14 筆 runtime chunk 失敗，合計 17 次，另有 script 資源失敗 | 部分可由更新快取後重載復原。本次統一各錯誤邊界的復原流程；等待同一次重載的重複事件合併，冷卻期間仍失敗則照常回報。 |
| 715 筆 CSP，合計 2,149 次 | 不能整批當誤報。`/email` 的樣式阻擋可在瀏覽器重現；本次讓撰信及寄信紀錄的預覽樣式取得當頁 nonce，並在清理 HTML 的初次解析前處理，避免解析本身製造 CSP 告警。其他 CSP 保留回報。 |
| `api.withFallback` 的「登入已過期」 | 正常身份狀態不應重複開事件。本次只排除 `ApiError(401)`，仍執行原 onError 與 fallback；403、404、429、500、503 的測試確認仍回報。 |
| 92 筆資源失敗，合計 306 次 | 圖片／CSS／script 失敗混合；除了上述 chunk 復原，不擴大忽略清單。報告缺少實際 HTTP 狀態，無法判定每筆是資源遺失、網路問題或瀏覽器環境。 |
| API 網路、逾時、離線及刷新失敗 | 舊資料包含已修正的 body 錯誤，不能全部視為斷網。目前離線與 report-only CSP 的 durable incident 過濾已存在。本次保留真正網路／逾時回報。 |
| 10 筆 Redis／DNS／連線類後端事件，合計 30 次 | 真實可用性問題，保留告警與登入 fail-closed 行為。僅憑匯出報告無法證明服務已恢復，需對照正式服務當時的 Redis、DB 與 DNS 紀錄。 |
| 其餘 window runtime／hydration 錯誤 | 已有瀏覽器擴充套件雜訊過濾；其餘保留。壓縮 stack 與匯出訊息不足以定位具體 DOM 或程式狀態，不以屏蔽訊息當修復。 |
| 4 筆慢查詢，54.6–93.6 ms，各 1 次 | 匯出類型是 `slow_query`／`observed`，並非事故。樣本不足以證明持續性效能退化，保留觀測。 |

## 新增保護與驗證

- 同源 Next chunk 才會自動復原；外站模組、一般 runtime 錯誤照常回報。
- sessionStorage 無法使用時停止自動重載，避免跨頁重載迴圈；選用 metrics 的儲存讀取失敗不再阻止原錯誤上報。
- 清快取最多等 1 秒；同頁多個 chunk 失敗共用一次重載，跨重載仍沿用原有 30 秒冷卻限制。
- 預覽仍先經 DOMPurify；scripts、嵌入文件、表單、事件 handler 與危險連結皆有測試。iframe sandbox 與站台 CSP 沿用既有設定。
- `bash scripts/check.sh web`：lint、模組對照、型別、80 檔／386 項測試與 production build 通過；保留 7 個既有 lint warning，以及 Vite／Sentry 的既有設定或棄用提示。Coverage 僅涵蓋 Vitest 設定選定的檔案。
- 最後補上無 nonce 頁面案例後，`npm test --prefix apps/web` 為 80 檔／387 項通過；相關四個測試檔共 42 項通過。文件檢查及四項維護入口回歸也通過。
- 真實 Chromium：單一 boundary 重載 1 次、連續資源失敗重載 1 次、持續失敗上報 1 次；快取刪除不回應時約 1,049 ms 重載；儲存被封鎖仍回報資源錯誤，一般 runtime 也正常回報。
- 真實 Chromium 的 1280／390 px：原預覽樣式被 CSP 阻擋，修正版套用預期文字顏色；單獨解析修正版 HTML 的 CSP 告警數為 0。
- 瀏覽器驗證使用本機隔離頁，載入本次編譯的 reporter／preview helper 與實際 DOMPurify；reporter 的 API URL／metrics 以測試替身隔離。這不是已登入正式頁面的端到端驗證。
- `bash scripts/check.sh api-test ...`：在測試前的安全檢查即停止，缺少合規的 loopback PostgreSQL `TEST_DATABASE_URL`；未連正式 DB，未以 SQLite 結果替代。

## 影響分析與交付邊界

GitNexus 綁定 `/home/ted98/projects/main`，先完整重建再分析。
`reportClientError` 的直接呼叫者包括各層錯誤邊界、API transport、request、withFallback 與全域 error／rejection／CSP listener；屬 CRITICAL 共用入口，已以完整 Web 檢查與針對性測試驗證。
`recoverFromChunkFailure` 直接由全域資源錯誤入口呼叫，現也供共用回報入口使用。
`ComposeInner` 影響撰信頁；`global-error.tsx` 是 Next.js 框架入口，圖譜無 caller 以檔案慣例補查。
寄信紀錄頁未被圖譜收錄（UNKNOWN），已逐一核對兩個詳情載入分支、個人化預覽 callback、iframe 消費點及型別／build。
提交前的 `detect-changes --scope all --repo . --limit 1000` 已執行；結構化結果沒有 partial／truncated。
整體結果也包含其他來源的導覽／樣式修改，不能歸為本次變更；文件、新檔及圖譜缺漏另以文字引用、測試與差異審查補查。索引的流程採樣仍不代表完整跨框架執行圖。

本次不修改歷史事件狀態、不清除正式資料、不部署、不 push。
後續最小步驟：部署經審閱的 commit 後，以新事件確認 chunk／郵件 CSP 是否下降；
若仍有 DNS、Redis 或上傳圖片失敗，須帶當時服務紀錄及資源 HTTP 狀態續查，不把舊事件直接結案。
