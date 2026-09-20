# HCCA 深度盤點：權限邊界、資料生命週期、併發與頁面驗收

盤點期間：2026-09-20 至 2026-09-21，Asia/Taipei。正式站：[hcca.tw](https://hcca.tw)。
起始程式基準：`12a23bcb`；收尾比對基準：`ce77b215`（後續提交僅改地圖／憑證描述等，本文發現所引用核心檔案 SHA-256 未變）。期間另有使用者的未提交修改，未混入本次提交。

**結論：介面與基礎防護有一致的架構，但模組之間的權限、匿名性、交易與資料契約仍未閉合。這輪確認 16 組深入問題：P1 11 組、P2 5 組；沒有把掃描器提示直接算成漏洞。** 其中 D01–D15 有本機程式／隔離重現證據，D16 是重複觀察到的正式站現象，根因仍需部署環境定位。另追蹤上一輪尚未通過驗收的公開公文；錯誤狀態問題則補查框架行為與 noindex，不重複計數。

本次最值得先處理的不是版面微調，而是：匿名問卷可反查身分、密件透過行事曆洩漏、跨組織訂單可讀、帳號切換帶出前一人的草稿，以及私有公文被匿名 SSR 預載提前判成不存在。

## 如何閱讀證據

- [完整頁面與 API 清冊](ROUTE_INVENTORY.md)：180 個頁面、75 個 Router 檔案、1,104 個 HTTP 宣告與 4 個 WebSocket 宣告；每個頁面都有覆蓋標記。
- [結構化實測證據](evidence.json)：診斷輸出、驗證摘要、正式站不同部署批次的觀察。
- [可重跑的診斷程式與操作說明](repro/README.md)：14 個 PostgreSQL 診斷案例、實際 React 草稿／SSR／HTTP 串流測試。
- [上一輪報告](../2026-09-20/WEB_AUDIT.md)：本輪有意延伸到其未深入驗證的業務、併發與跨模組邊界。

這裡的「診斷通過」表示**成功重現文件中的錯誤行為**，不是修復完成。程式修正後，這些診斷應改成保護正確行為的回歸測試。

## 覆蓋範圍與限制

列冊涵蓋全部 180 個 `page.tsx`：40 管理群組、84 保護群組、48 公開群組、8 未分組入口；126 個入口直接宣告 `use client`，36 個含動態參數。路由群組名稱不作為權限有效的證據。

本輪用真實 Chromium 瀏覽 **42 個不同正式站路徑**，桌面 1440×900、手機 390×844，另複查淺色／深色、錯誤路徑、登入導向及公開文件連結。正式站只做公開頁面與唯讀請求，沒有提交陳情、問卷、訂單或改動帳號。受保護與管理頁的正式站證據限於匿名導向；沒有正式測試帳號，因此不宣稱已逐頁完成所有登入角色的端到端驗收。

後端使用獨立 PostgreSQL 16 與 Redis 7，限本機 loopback；真實 ORM、約束、交易與查詢均未 mock。外部寄信／分析副作用及特定 Redis 故障條件可用測試替身。HTTP router 測試沿用專案的身分注入 fixture；它證明 router/service 授權分支，不等同於 OAuth 全流程。WS 撤銷案例另外使用真實簽發 token 與持久化 session。

GitNexus 先查流程／符號，再讀邏輯核心。索引曾更新至起始版本，收尾再刷新；圖分析本身有入口、深度與跨語言解析限制，不能把缺少邊或空結果當成無影響。沒有進行全站流量壓測、第三方帳戶授權、正式資料歷史稽核、備份還原演練或完整滲透測試。

### 覆蓋矩陣

| 領域 | 本輪檢查深度 | 結論／仍待驗收 |
|---|---|---|
| 登入、工作階段、撤銷 | 對照 HTTP 與 WS 路徑；真實 token、DB 撤銷狀態、Redis 鍵缺失 | HTTP 已補強；WS 尚有 D05 差異 |
| 組織／任期 | 真實過期任期，跨問卷與組織 WS 授權 | D06；不是宣稱整個 RBAC 都失效 |
| 公文／行事曆 | 來源權限、投影權限、匿名 SSR、兩個 DB session 競態 | D03、D14、D15；公開詳情另見舊案追蹤 |
| 問卷 | 匿名資料流、必填／選項、重複填答、DB 唯一約束、試算表匯出 | D01、D09–D12 |
| 學餐 | 管理範圍、明細與列表差異、新舊訂單 DTO、取消截止、重複品項約束 | D02、D07、D08；排除一項超賣疑點 |
| 購票 | 查閱鎖定、版本欄位與交易處理；既有完整測試套件 | 未證實超賣；未做正式金流／退款端到端操作 |
| 前端共用層 | 登出、localStorage 草稿、IndexedDB 鍵設計、逾時生命週期 | D04、D13；文字草稿有實際 hook 重現，附件部分為程式追蹤 |
| 公開頁與地圖 | 真實瀏覽、手機、axe、部署前後比較 | D16；地圖、匿名陳情入口與問卷錯誤狀態已在後續批次改善 |
| 儲存／Webhook／儀表板 | 定向追蹤儲存 I/O、URL 驗證、並行 session 管理 | 有既有保護；未把模式搜尋結果冒充漏洞 |
| 財務、選舉、簽核、通知、管理工具等其餘模組 | 全部路由列冊＋既有測試；部分公開入口瀏覽 | 仍需各角色、真實外部整合、長交易的驗收；清冊明示未實測頁面 |

## 修復優先序

P1 表示權限／隱私、業務資料或主要操作受實質影響，應在相關功能擴大使用前處理；P2 表示可靠性、效能或資料品質風險，應安排下一輪。沒有把具備條件的漏洞描述成任何匿名訪客都能利用，也沒有將所有操作阻礙一律升為 P0。

| 編號 | 等級 | 問題 | 最強證據 |
|---|---|---|---|
| D01 | P1 | 匿名問卷的稽核紀錄直接連回使用者 | 真實 router＋PostgreSQL |
| D02 | P1 | 學餐管理者可讀其他組織訂單明細 | 同一身分：列表 403、明細 200 |
| D03 | P1 | 密件透過行事曆暴露標題與主旨 | 來源拒絕、投影回應可序列化 |
| D04 | P1 | 切換帳號會自動還原前一帳號的公文草稿 | 實際 React hook＋實際登出清理 |
| D05 | P1 | Redis 撤銷證據消失時，WS 接受 DB 已撤銷 session | 相同 token：HTTP 拒絕、WS 接受 |
| D06 | P1 | 過期組織任期仍通過問卷與 WS 存取 | 真實過期會員記錄 |
| D07 | P1 | 平台式學餐訂單讓列表整體回應 500 | 實際 ASGI 路由序列化失敗 |
| D08 | P1 | 平台式訂單可在截止後取消已確認訂單 | 截止 3 小時後仍變 cancelled |
| D09 | P2 | 必填空答案與不存在的選項可存入問卷 | PostgreSQL 保存錯誤答案 |
| D10 | P1 | 重複填答設定與匿名憑證／唯一約束互相矛盾 | 禁止重複卻接受；允許重複卻 DB 拒絕 |
| D11 | P1 | 問卷輸入在 Excel 匯出時成為公式 | `=1+1` 被寫成公式型儲存格 |
| D12 | P2 | 問卷匯出阻塞 async 事件迴圈 | 20,000 筆答案、心跳實測 |
| D13 | P2 | 逾時在標頭抵達後失效，讀本文可持續卡住 | 本機真實 HTTP 串流等待逾 16 秒 |
| D14 | P2 | 行事曆投影的競態回復使交易失效 | 兩個真實 PG session，一個 PendingRollbackError |
| D15 | P1 | 私有公文被匿名 SSR 的 404 提前截斷 | 私有 API 擁有人可讀＋實際頁面函式拋 404 |
| D16 | P2 | 正式站公文列表重複發生 hydration 失敗 | 桌面／手機多次 React #418 |

## 深入發現

### D01 — 匿名問卷仍留下身分與答案的直接關聯

**位置：** `apps/api/src/api/routers/survey.py:440` 的 `submit_response`；`apps/api/src/api/models/survey.py:211`；`apps/web/src/app/(public)/surveys/[id]/client.tsx:1189`。

匿名模式將 `SurveyResponse.respondent_id` 清空，卻在同一個提交路由寫入 `AuditLog(entity_id=response.id, actor_id=user.id, actor_email=user.email)`。只要將稽核的 entity_id 與回應主鍵連接，就能把答案重新連回本人。這違背畫面的「身分不會與填答內容關聯」承諾。

**重現：** 登入者送出匿名回答後，DB 的 respondent_id 為 null，但稽核 actor、email 與回應 ID 全部能精確對上。測試未依賴時間比對或機率推測。另有以 user.id 記錄參與問卷的分析事件；只確認參與資訊，未聲稱答案正文送往 PostHog。

**影響前提：** 能讀取稽核與回答資料的維運／管理路徑可重建關聯；不是匿名訪客直接讀走答案。即使前端隱藏姓名，匿名隔離仍不成立。

**修復與驗收：** 匿名答案稽核不得包含可回連該答案的使用者識別；資格／防重複憑證與答案庫分離。對匿名與具名模式分別驗證 DB、稽核、分析、Email 副本與匯出。歷史紀錄需依保存與稽核需求制定處理方案，不宜直接任意刪除。涉及資料結構調整時須有 Alembic migration。

### D02 — 學餐的列表範圍與明細範圍不一致

**位置：** `apps/api/src/api/routers/meal.py:809`、`:1033`。

列表會檢查供應商是否屬於目前管理者的組織；明細則在非本人訂單時，只確認全域權限集合中有 `meal:manage`，沒有再核對訂單供應商的組織。

**重現：** 為 A 組織的一般使用者授予 `meal:manage`，建立 B 組織訂單。同一身分列 B 供應商訂單得到 403，但以該訂單 UUID 讀取明細得到 200，內容包含另一使用者 ID、取餐碼及備註。

**影響前提：** 需要一個有學餐管理權的帳號及目標訂單識別碼；沒有證實匿名枚舉或不需登入的存取。

**修復與驗收：** 在 router 的資源範圍依賴中統一檢查 `order → vendor → org`，套用明細、查碼、匯出與異動入口。用 A/B 組織、本人／他人、有效／過期任期建立相同授權矩陣；service 保持既有分層原則，不自行重複 RBAC。

### D03 — 公文權限在行事曆投影時被放寬

**位置：** `apps/api/src/api/services/coordination.py:217`；`apps/api/src/api/services/calendar.py:118`；`apps/api/src/api/routers/calendar.py:121`；`apps/api/src/api/services/document/_access.py:432`。

公文投影把有期限的未封存文件轉為預設 `ORG` 可見事件，直接複製標題與 `subject`／`doc_description`。讀取事件時只套行事曆可見性，沒有繼承來源公文的 `SUBJECT_ONLY` 閱覽限制。

**重現：** 建立一份密件與同組織普通成員（不是建立者／收件者／上層成員）。`check_document_access` 回 false；投影後 `calendar.list_events` 卻回傳該文件的標題、主旨、來源 ID 與連結，而且 `CalendarEventListItem` 可正常序列化。

**影響：** 不必開啟原文就能取得敏感案件摘要。來源模組的測試全部通過，仍無法保護複製到其他模組的資料。亦應以相同方法複查問卷、工作項目、Email 等投影，但本次沒有把所有投影都列成已證實洩漏。

**修復與驗收：** router 取得事件時，對來源建立可讀範圍；投影儲存必要資訊即可，不能以一般 ORG 可見性代替來源規則。修復後處理既有投影資料，並驗證來源改密、封存、刪除、移轉組織後，舊事件不再暴露內容。不要只刪除前端連結。

### D04 — 共用瀏覽器中，登出沒有隔離草稿

**位置：** `apps/web/src/app/(protected)/documents/new/page.tsx:471`、`:587`、`:612`；`apps/web/src/app/(protected)/announcements/new/page.tsx:84`；`apps/web/src/hooks/useDraftAutosave.ts:44`；`apps/web/src/lib/auth-cache.ts:134`。

公文草稿使用固定 `documents:new` 或模板 ID，公告使用 `announcements:new`，都沒有使用者範圍。登出清除身分快取、API 快取與 SW 私有快取，但草稿 localStorage 沒有清除。下個帳號進入同一表單便自動還原。

**重現：** 用實際 `useDraftAutosave` 儲存 A 的合成私人內容，執行實際 `clearAuthCache`（包含實際 `cachePurge`），將目前帳號設為 B，再掛載同 key 的表單 hook。B 的 restore callback 收到 A 的內容。

**影響前提：** 同一瀏覽器資料區跨帳號使用，尤其公用電腦。未主張可跨裝置讀取。附件使用 IndexedDB 同類無使用者 key，屬程式證據；本次動態重現的是文字草稿。陳情新增頁已有使用者範圍，不應把它也算成相同缺陷。

**修復與驗收：** key 必須包含穩定 user ID，恢復前驗證 owner；針對舊版無主草稿設計清理或安全遷移。登出／撤銷時清除敏感草稿，或採明確保留政策且保持帳號隔離；文字與附件一起處理。驗收 A→登出→B、同帳號重登、代理操作與多分頁情境。介面修復可用 `$impeccable harden`。

### D05 — HTTP 已撤銷的 session，WebSocket 仍可接受

**位置：** `apps/api/src/api/routers/ws.py:106`、`:149`；對照 `apps/api/src/api/dependencies/auth.py` 的 `_user_from_access_token`。

HTTP 已回資料庫確認 User／UserSession；WS 的 `_authenticate_ws` 仍只依 JWT 與 Redis 撤銷／黑名單結果。當 Redis 撤銷鍵消失或未成功保留，WS 沒有使用 DB 的 revoked_at 補救；個人房間的存取判斷也不等同於重新確認有效帳號。

**重現：** 建立已撤銷但 access token 尚未過期的持久化 session，將 Redis 查詢設定為「鍵不存在」。相同 token 在 HTTP 驗證回 None，WS 驗證卻回有效身分。

**影響前提：** 持有撤銷前的合法憑證，而且 Redis 撤銷證據不存在。沒有證明 token 偽造，也未測正式 Redis 故障。此為上一輪 HTTP 撤銷修復尚未覆蓋的通道，不是宣稱 HTTP 修復無效。

**修復與驗收：** 讓 HTTP 與 WS 共用持久化身分／session 驗證；對既有連線實作撤銷與停用後的關閉機制。驗收鍵缺失、連線失敗、停用、任期變更、過期，以及持續連線的撤銷通知，不只測重新握手。

### D06 — 問卷與組織 WS 把歷史職位當成目前職位

**位置：** `apps/api/src/api/services/survey.py:207`；`apps/api/src/api/routers/ws.py:149` 的組織房間分支。

這兩條路徑查 `UserPosition → Position.org_id` 時缺少任期起迄條件，與核心權限引擎的 `active_tenure_filter` 規則不同。

**重現：** 一個職位任期在 2020-12-31 結束的使用者，仍通過限制該組織的問卷存取，以及該組織 WS 房間檢查。資料庫查詢是真實的；WS 測試只排除無關的快取權限捷徑。

**修復與驗收：** 以共用的「目前有效組織成員」查詢取代裸 join，權限決策仍由 router 邊界負責。驗收未開始、到期當日、已過期、無結束日及停用組織。不要只讓前端把入口隱藏。

### D07 — 新式學餐訂單讓整份列表序列化失敗

**位置：** `apps/api/src/api/services/meal/_order.py` 的 `create_platform_meal_order`；`apps/api/src/api/schemas/meal.py:334`；`apps/api/src/api/routers/meal.py:809`。

平台式訂單正常使用 `pickup_slot_id`，`schedule_id=None`；但列表 DTO 的 schedule_id 仍要求 UUID。明細 DTO 與建立流程已接受 null，列表契約卻沒同步。

**重現：** 在真實 DB 放入平台式訂單，呼叫 `/meal/orders`，FastAPI 報 `ResponseValidationError: response[0].schedule_id UUID input ... input=None`。這不是前端單列顯示缺字，而是整個列表回應失敗。

**修復與驗收：** 將列表 DTO 明確表達兩種訂單來源，更新 `lib/types.ts`／產生的 API 型別與相關 UI。只改回應型別通常不需 DB migration；若順便更動 schema 則必須建立 migration。驗收純舊式、純平台式、混合列表、本人與班級清單，以及取消後仍能閱讀列表。

### D08 — 平台式訂單的截止時間沒有套用到取消

**位置：** `apps/api/src/api/services/meal/_order.py:350`；`apps/api/src/api/routers/meal.py:1058`。

取消服務檢查傳統 `MenuSchedule.is_closed`，卻沒有對 `schedule_id=None` 的平台式訂單核對 `MealPickupSlot.order_deadline`；也沒有因原狀態為 confirmed 就拒絕。

**重現：** 使用真實供應商、商品、上架與取餐時段，截止時間設為三小時前，訂單已 confirmed。本人仍能成功取消，結果為 cancelled。程式也會進入取消應收流程；本次未建立完整付款對帳，因此不量化財務損失。

**影響：** 廚房／供應商可能已備餐，使用者卻仍能改變結算依據。前端不顯示取消按鈕無法補足 API 狀態規則。

**修復與驗收：** 在業務服務中依訂單來源統一判斷取餐時段、截止、確認／付款狀態與管理例外；取消與結單需要原子狀態檢查。驗收截止前後、已確認、已付款、管理者例外，以及取消與結單同時發生。

### D09 — 問卷的必填與可選值只在表面成立

**位置：** `apps/api/src/api/services/survey.py:500` 起的 `submit_response`；`apps/api/src/api/schemas/survey.py` 的 `AnswerSubmit`。

必填檢查只確認答案陣列含該 question_id，TEXT 沒有正文也能通過；SINGLE 的值亦未完整限制於已設定選項。

**重現：** 必填 TEXT 只有 question_id，沒有內容；另一題可選 A/B，卻提交 `NOT-AN-OPTION`。兩者都成功存入 PostgreSQL，值分別為 null 與非法選項。

**影響：** API 客戶端或被修改的表單可產生不符合問卷定義的答案，統計與匯出會納入無效資料。沒有據此宣稱所有題型都未驗證。

**修復與驗收：** 伺服器依題型驗證非空、合法選項、選取數、數值範圍；同時核對未知／重複 question_id 與條件式必填。用直接 API 的非法輸入測試，避免只測 UI 的 required 屬性。

### D10 —「允許重複填答」在匿名與具名模式都不可靠

**位置：** `apps/api/src/api/services/survey.py:472`；`apps/api/src/api/models/survey.py:220`；`apps/web/src/app/(public)/surveys/[id]/client.tsx` 的 anon_token 產生處。

匿名、不允許重複時，anon_token 可省略；省略就不進行該憑證的重複檢查。即使使用 UI，提交時產生新的隨機 token 也不是穩定的「同一填答者」憑證。反方向，具名且允許重複時，service 雖跳過檢查，DB 的 `(survey_id, respondent_id)` 無條件唯一約束仍會拒絕第二次。

**重現：** 同一匿名問卷 `allow_multiple=false`，連續兩次不帶 token 皆成功；具名問卷 `allow_multiple=true`，同一使用者第二次觸發 IntegrityError（router 有衝突處理，不能誤寫為任意 500）。

**修復與驗收：** 先明定防重複是每人、每資格憑證或每裝置；開放匿名網頁不能只憑隨機 token 宣稱一人一票。將參與憑證與答案身分隔離，同時讓 DB 約束與開關一致。調整約束需 Alembic migration。驗收兩模式×兩開關、重新整理、兩個同時提交，以及匿名性不因修復而變差。

### D11 — 不可信答案在 XLSX 中被當成公式

**位置：** `apps/api/src/api/services/survey.py:740` 的 `build_survey_export`，Pandas／Openpyxl 寫檔段。

**重現：** 問卷 TEXT 答案填入無害字串 `=1+1`，匯出後用 Openpyxl 以 `data_only=False` 讀取。「回應明細」C2 的 `data_type` 是 `f`，代表公式，而非原始文字。

**影響前提：** 操作者下載並用會解讀公式的試算表軟體開啟。已證實的是資料被轉為公式；沒有執行資料外傳、巨集或宣稱遠端程式執行。其他匯出路徑有相似 Pandas 使用方式，但尚未全部逐一重現。

**修復與驗收：** XLSX 對使用者輸入強制寫為字串儲存格；保留系統自行建立的合法公式。CSV 另採一致的防公式處理。驗收 `=1+1`、前導符號、一般數字與多語文字在 Excel／LibreOffice 開啟後均維持資料語意。相關機制見 [OWASP 公式注入說明](https://owasp.org/www-community/attacks/CSV_Injection)。

### D12 — 匯出在 async 函式內長時間佔住事件迴圈

**位置：** 同 D11；`build_survey_export` 內同步 DataFrame／ExcelWriter／Openpyxl 工作。

**實測：** 隔離 PostgreSQL，2,500 份回應×8 題，共 20,000 筆答案；Pandas 預先載入。最後一次匯出 1.804 秒、XLSX 88,868 bytes；同 event loop 的 10ms 心跳最大間隔 **436.2ms**。重跑時量測會隨機器負载不同，先前亦觀察到更長間隔；不將單次結果外推成正式站 p95。

**影響：** 同一 worker 正在服務其他請求或 WS 時，該 CPU／同步寫檔區段不能及時讓出執行權。這個問題不會被「函式有 async」或單筆功能測試發現。

**修復與驗收：** 完成必要的非同步 DB 讀取後，把純序列化／試算表產生移到執行緒或背景工作；不要把同一 AsyncSession 帶進執行緒。大型匯出採工作佇列與下載成品，明定大小／時間上限。驗收並行一般 API 的延遲與匯出取消，而不只是檔案成功生成。效能流程可用 `$impeccable optimize`。

### D13 — 請求逾時只涵蓋收到標頭之前

**位置：** `apps/web/src/lib/serverFetch.ts:29`；`apps/web/src/lib/api/transport.ts:124`；呼叫端 `api/core.ts` 之 `response.json()`。

`fetch` 收到標頭即可 resolve。兩個共用函式在返回 Response 的 finally 便清除 AbortController 計時器，之後才由外層讀取 JSON。本文尚未收完時已失去 5 秒／15 秒的保護；前端還移除了原始 signal 的轉送 listener。

**重現：** 本機 HTTP server 立即送 200 JSON 標頭與半段 JSON，保持連線。用實際 TypeScript 模組轉譯執行：16,009ms 時前後端讀取均未完成，標頭早已收到；不是以 mock fetch 直接回一個永遠 pending 的 Promise。完成觀察後關閉測試 socket。

**影響：** 上游串流、代理或下載中斷時，頁面可能長時間 loading，SSR 也持續等待。仍可能受網路堆疊／反向代理的其他上限限制，因此不聲稱一定永遠不結束。

**修復與驗收：** 把 timeout／abort 的生命週期延伸到本文讀取完成；JSON、blob、錯誤本文與上傳均需明確 ownership。重現「標頭慢」「標頭快本文慢」「已收到標頭後使用者取消」三類案例。介面錯誤狀態可用 `$impeccable harden`。

### D14 — 處理行事曆投影衝突的 savepoint 建立得太晚

**位置：** `apps/api/src/api/services/coordination.py:168`–`:187`。

`session.add(candidate)` 在 `begin_nested()` 外面。SQLAlchemy 進入 nested transaction 前會先 flush pending 物件；兩個第一次讀取相同來源的請求同時 insert 時，唯一約束衝突發生在預期的 savepoint 建立之前。except IntegrityError 再查詢時，session 已處於需要 rollback 的狀態。

**重現：** 兩個獨立 PostgreSQL session 實際執行相同 `_upsert_projection`。只在兩個真實 SELECT 完成後加同步障壁，固定「雙方皆尚未看到事件」的交錯；沒有替換 DB 查詢結果。結果一個 committed、另一個 `PendingRollbackError`。

**修復與驗收：** 把候選物件的 add／flush 放入已建立的 savepoint，或用 PostgreSQL upsert，再處理必要的參與者唯一約束。驗收同來源雙請求、批次中某筆競態、外層已有其他異動等情境。官方說明確認 `begin_nested()` 的前置 flush 語意，見 [SQLAlchemy SAVEPOINT](https://docs.sqlalchemy.org/en/20/orm/session_transaction.html#using-savepoint)。

### D15 — 匿名 SSR 的 404 會擋住本來有權限的私有公文

**位置：** `apps/web/src/app/(public)/documents/[id]/page.tsx:39`；`apps/web/src/lib/publicSeoFetch.ts:32`；`apps/web/src/lib/serverFetch.ts:29`；`apps/api/src/api/routers/documents.py:366`。

這是公開與登入詳情共用路由的邊界問題。SSR 呼叫公開 fetch，不帶使用者 cookie；私有公文按後端規則對匿名者回 404。頁面立即 `notFound()`，因此還沒機會 render `DocumentDetailEntry`，更到不了登入者的詳情讀取。瀏覽器 localStorage 中有 user_id 不能救回已被 server 截斷的頁面。

**重現分兩層：** 真實 DB 的私有公文在實際 router 函式中，匿名讀取 404、建立者讀取得到文件；實際 `page.tsx` 轉譯後，輸入該匿名預載結果，呼叫 Next 的真實 `notFound`，拋出 `NEXT_HTTP_ERROR_FALLBACK;404`，即使瀏覽器有 B 的身分快取亦然。第二層是受控資料邊界測試，未宣稱已用正式登入帳號端到端重現。

**影響：** 修復公開 404 時可能連帶讓合法使用者無法開啟、簽核私有公文；不能只驗收匿名公開頁。這條路徑無須 Redis 故障或競態。

**修復與驗收：** 區分匿名「不可公開」與經過身分確認的「不存在」。有登入工作階段時走私有、不可共用快取的資料讀取，或保留登入詳情入口交由後端授權。絕不可把使用者 cookie 帶入共用 public cache。驗收匿名不存在、匿名私有、本人私有、他人私有、代理工作階段與公開文件。可用 `$impeccable harden` 處理錯誤／登入狀態。

### D16 — 公文列表發生 hydration mismatch，根因尚未定案

**位置：** 正式站 `/documents`；候選位置為 `apps/web/src/app/(public)/documents/client.tsx` 的日期與初始資料 render。

桌面與手機、更新前後多個獨立瀏覽批次均捕捉 React #418（text mismatch）；頁面仍能顯示列表，因此沒有描述成全頁當機。React 對此錯誤的定義是伺服器與客戶端內容不一致，需要在客戶端重建該樹，見 [React #418](https://react.dev/errors/418)。

本機 development server 在 Los Angeles 時區未重現同一錯誤。日期確實隨瀏覽器時區變化，且多處 `toLocaleDateString("zh-TW")` 未指定 timeZone，但這只是候選根因，**不能直接斷言就是日期造成 hydration 失敗**。也可能涉及部署端時區、快取或初始快照。

**修復與驗收：** 取得實际部署版本的 SSR HTML 與 hydration 前後資料，啟用可定位 component 的錯誤資訊；公務日期明定 Asia/Taipei 或 date-only 語意。以 production build 在 UTC／台北／洛杉磯、跨日、冷暖快取測試。不要用全域 `suppressHydrationWarning` 隱藏訊號。可用 `$impeccable harden`。

## 正式站部署前後驗收：哪些已改善、哪些還沒有

盤點期間實際發生部署，不能把不同批次數據混成同一個版本。`evidence.json` 保留 `browser-final` 與較晚的 `browser-release-check`，後者優先代表收尾觀察。

| 項目 | 早期觀察 | 收尾複查 | 判斷 |
|---|---|---|---|
| 地圖底圖 | CARTO tile 回圖但有 API KEY REQUIRED 浮水印 | 已改 Esri，8 張可見 tile 均 naturalWidth=256，截圖無浮水印 | `4c398e54` 已在公開地圖生效，不列為未修復問題 |
| 匿名陳情 | 可進完整表單，直到送出才會遇到身分問題 | 現在先提示登入，保留合理返回流程 | 上輪 F07 公開入口已通過這項複查 |
| 關閉中的問卷 | 顯示無問卷 | 現在明示關閉／維護，提供重新載入 | 上輪 F11 的錯誤狀態已改善 |
| 公文手機對比 | axe 一次命中 10 個節點 | 更新後相同 viewport 抽測未再命中 | 此頁樣本改善；不代表全站 AA 認證 |
| 公開公文詳情 | 列表有文件，點入顯示不存在 | 更新後改成 not-found 畫面，API UUID／字號仍 200 | **上輪 F05 未通過驗收**，尚非「已修好」 |
| 不存在的公文／法規 | HTTP 200＋錯誤內容 | 新 not-found 畫面仍 HTTP 200，但已含 robots noindex | 已進入框架 not-found；不能僅憑 200 判為未修復，見下方說明 |
| 公文列表 hydration | React #418 | 後續新批次仍捕捉到 | D16 仍成立 |

**對上一輪 F13 的判斷修正：** 最後另外取得兩個不存在路徑的原始 HTML，均含 `<meta name="robots" content="noindex"/>`。Next.js 官方說明 streamed not-found 回應可以是 200、非串流才是 404。因此這次不把「200」單獨繼續列成缺陷，也沒有證據聲稱搜尋引擎實際誤收錄。若營運另要求所有機器客戶端均取得 404，應明訂為 HTTP 契約再驗收。見 [Next.js not-found 規範](https://nextjs.org/docs/app/api-reference/file-conventions/not-found)。

公開文件複查識別碼為 `88d2b308-465b-47c8-a9d4-2557f279ae49`，字號「嶺代綜字第 1150000001 號」。兩個 API 路徑均 200；頁面列表所產生的連結卻顯示不存在。未取得正式 SSR 執行環境設定與部署日誌，因此未把原因武斷指定為 CDN 或後端資料不存在。D15 的私有公文問題與此公開文件問題也不應混為同一根因。

地圖修正前後：[修正前](assets/map-before.png)、[修正後](assets/map-after.png)。CARTO 已要求 key，且官方說明缺 key 會顯示浮水印；這說明 HTTP 200 與無 console error 仍不足以驗收第三方圖片。見 [CARTO 說明](https://carto.com/basemaps/apikey/)。目前採用不同底圖，因此沒有建議繼續為舊 provider 增補 key。

## 效能與品質檢查：結果及其可用範圍

| 驗證 | 結果 | 正確解讀 |
|---|---|---|
| API 全套，真實 PostgreSQL＋Redis | **1,887 passed，37 warnings，103.34 秒** | 基線功能測試通過，沒有覆蓋本輪所有跨邊界缺陷 |
| 新增隔離診斷 | **14 passed，1 warning** | 成功重現／排除文件所述案例；不是產品已修復 |
| 前端既有單元測試 | **26 檔、97 tests passed** | 通過既有案例 |
| 前端 coverage | statements 92.35%、lines 98.63% | 設定僅統計 4 個指定檔案，**不是整個前端的覆蓋率** |
| Ruff／format／前端 lint／type-check | 通過 | 靜態與格式檢查，不能證明授權或交易正確 |
| Next production build | 通過 | 起始程式基準成功建置；後續其他提交未冒稱由本輪全套再測 |
| npm audit，production dependencies | 0 已知漏洞 | 套件資料庫未報告，不等於無業務邏輯漏洞 |
| 最初缺 Redis 的測試啟動 | 大量環境連線錯誤 | 已改用隔離服務重跑，未把環境錯誤列成網站缺陷 |

手機樣本（未限速、無 CPU 降速）首頁 TTFB 約 1,042–1,045ms、LCP 1,436–2,512ms；公文列表 TTFB 335–363ms、LCP 616–1,580ms。這是兩個 theme 批次的短時間觀察，無 p75／p95 意義；快取、連線與部署都影響結果。觀察窗 CLS 為 0，不表示互動全程永不位移。腳本解壓大小約首頁 618KB、公文列表 692KB，同樣不等於線上傳輸量，也不是僅憑數字就新增 bundle 問題。

較可靠的效能發現是 D12 的事件迴圈停頓與 D13 的 timeout 失效，因為已有明確觸發條件與對照，而不是只憑 Lighthouse 分數推論原因。

### 介面品質評分（僅限已觀察樣本）

| 面向 | 0–4 分 | 依據 |
|---|---:|---|
| 無障礙 | 3 | 公開樣本更新後 axe 結果改善；未完成所有登入頁及輔助科技人工驗收 |
| 效能 | 2 | 有快取、分割與預載；共用本文逾時與同步匯出仍有實測問題 |
| 響應式 | 3 | 抽測桌面／390px 無頁面水平溢出，表格轉手機列表；其他尺寸與文字放大仍有限 |
| 主題 | 3 | 抽測淺／深色一致，沒有以硬編碼搜尋量直接判定缺陷 |
| 實作品質一致性 | 1 | 來源權限、匿名承諾、跨帳號草稿與新舊訂單契約多處不一致 |
| 合計 | **12/20** | 有基礎，但仍需實質修正；不是安全評分或 WCAG 認證 |

Impeccable detector 的 11 個結構／樣式提示只作查核線索，沒有直接新增 11 個問題。跳至主內容抽測只證實連結可被 Tab 取得；尚未完整驗證所有瀏覽器的焦點移轉，未因此另加缺陷。

## 排除的疑點與應保留的保護

- **重複菜單品項超賣：** 同一品項各下 4 份、上限 5 份的可疑 payload，在真實 PostgreSQL 被唯一約束拒絕。沒有將前段逐筆數量檢查的疑點誤報為已成立超賣。
- **購票併發：** 程式有 row lock 與版本欄位；不能只看到「先查後寫」便斷言有競態。正式付款／退款競態仍需獨立驗收。
- **儀表板 AsyncSession：** 子工作使用分開的 session 管理，未把 `gather` 關鍵字直接視為共用 session 缺陷。
- **檔案 I/O：** 儲存核心已有 `anyio.to_thread`；不能將 async 服務中出現檔案處理一概列為阻塞。
- **Webhook：** 有 URL／公開位址限制；本輪沒有證實 SSRF。DNS／部署層仍非全面測試範圍。
- **目前 HTTP 身分驗證：** 已讀真實 User／UserSession；上一輪 transient 身分快照及全量撤銷問題不能原封不動重新算成新漏洞。
- **回應防護標頭：** 公開首頁實際有 HSTS、nonce CSP、frame-ancestors none、nosniff、referrer policy。這些值得維持，但不會修復 D01–D15 的業務邊界問題。

## 建議執行順序與驗收交付

1. **先處理資料與身分邊界：** D01、D02、D03、D04、D05、D06。每個修復都補上跨角色／跨模組的負向測試；不能只在原本失敗的畫面做遮擋。
2. **恢復主要工作流程：** D15 與公開公文舊案、D07、D08、D10。交付完整角色矩陣、新舊資料混合案例、截止前後與重複／併發操作結果。DTO 改動同步 `lib/types.ts`，DB 約束改動附 migration。
3. **保護資料品質與操作環境：** D09、D11；檢查其他使用相同匯出模式的服務，但逐一證實後才擴大修正。
4. **補可靠性與效能：** D12–D14、D16。以同時操作的延遲、失敗回復及資料一致性驗收，不以單頁看起來正常結案。
5. **介面工作可依序使用：** `$impeccable harden` 處理登入／錯誤／草稿狀態，`$impeccable optimize` 處理等待與大量資料流程，修復後 `$impeccable audit` 重測，最後 `$impeccable polish`。可逐項、整批或調整順序執行；這些指令不取代後端授權與交易修正。

本次交付是盤點、重現與驗收依據。未修改產品邏輯、正式資料或部署；新增報告及診斷檔案單獨提交，保留既有工作區變動。


## 交付檔案與圖分析紀錄

本次只新增此目錄的 9 個文件、證據與診斷檔案，未改產品函式。新增報告的 impact 查詢回 UNKNOWN／找不到節點，沒有把它視為低風險；已檢查專案引用與 staged diff，確認新增內容沒有掛入應用程式執行路徑。`docs/` 原本被忽略，本次只明確加入這 9 個檔案，未修改 ignore 規則。

提交前已更新索引並以 `detect-changes --scope all --limit 5000` 重跑。全工作區結果包含既有未提交的 admin／petitions／analytics 等程式變動，標為 critical；不應將其誤認為本次新增盤點文件造成的執行風險。本次 staged 範圍回報「有檔案差異，但沒有對應的 indexed symbols」，不能據此宣稱整個工作區 clean。採逐檔 diff 與來源 hash 確認本次提交範圍，其他變動保留未提交。

索引的流程列舉本身有截斷與解析限制，收尾刷新另出現 BM25 建索引失敗提示；先前已完成的具名 context／程式重現證據仍保留，但不把圖工具輸出當成完整性證明。隔離 PostgreSQL、Redis、本機 Next server 與本次瀏覽器工作階段均已關閉。
