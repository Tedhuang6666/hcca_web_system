# 舊系統與未接線程式盤點（2026-11-17）

> 本文保留清理前的歷史證據。已完成的處置與驗證見
> [清除結果](UNUSED_SYSTEMS_CLEANUP_20261117.md)，資料退役授權見
> [退役方案](UNUSED_SYSTEMS_CLEANUP_PLAN_20261117.md)。

## 結論與範圍

目前確有舊功能只移除入口、內部實作仍保留的情況。最明顯的是學餐、舊法規起草／
審議流程、治理中樞的管理介面，以及活動／總召管理的寫入功能。另找到 **9 個前端
孤立檔案、39 個未找到正式引用的服務函式、43 個沒有套件外正式呼叫的治理服務介面，
以及 30 個未找到 Python 正式引用且未出現在 OpenAPI 的 schema**。這些數字描述不同
層次，不能相加當作「停用系統數」；也不是可直接刪除的清單。

基準為 [61aa0ee1](https://github.com/Tedhuang6666/hcca_web_system/tree/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369)。任務開始時工作樹乾淨，GitNexus 回報索引與該 commit、1724 個
涵蓋檔案相符。盤點期間另有來源修改 `routers/shop.py`、`services/outbox.py` 並新增
`services/shop/_events.py`；收尾時其他工作又開始移除 `models/meal.py`、調整學餐相依，
並把 shop router 拆成套件。本報告以 commit 內的程式重算候選，不包含這些進行中的修改，
**不能把表中項目解讀為收尾時仍全部存在**。來源連結固定指向盤點基準 commit；下表行號與判定均以
該基準為準。

檢查涵蓋 API router／service／model／schema、Web 頁面入口與相對／`@/` import、
獨立 Discord bot、Celery 註冊／排程及 Compose 訂閱設定。排除秘密設定檔、上傳資料、
lockfiles、套件快取、生成型別全文及歷史 migration 全文。未查正式站流量、正式 DB
資料筆數、外部腳本或使用者書籤，因此「無正式引用」是本庫內的靜態結論。

判定方式：先用 CodeGraph／GitNexus 定位，再補 AST 的 import／名稱／屬性引用、字面量
搜尋、實際路由掛載、OpenAPI 快照及對應測試。測試引用、單純 re-export、ORM metadata
註冊與業務呼叫分開看。Web import 分析包含字面量 dynamic import，但不是完整編譯器
或執行期追蹤；已逐項核對下列 9 個候選，排除公開預算頁仍在使用的元件。

## 一、系統與流程層級

| 編號 | 項目與判定 | 證據位置 | 影響與後續處理邊界 |
| --- | --- | --- | --- |
| S01 | **Discord 學餐指令已斷線**。bot 仍註冊查菜單、下單、查訂單、取消功能，API 已無對應 handler。 | [bot loader](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/discord-bot/src/hcca_discord_bot/extended_commands.py) 第 21–24 行；[meal commands](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/discord-bot/src/hcca_discord_bot/meal_commands.py)；[gateway](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/discord_commands.py) 第 38–52 行 | 已綁定且通過身分檢查的使用者呼叫後，處理器會走到「不支援的 Discord operation」。這是仍對使用者顯示的殘留，優先處理。`AccountBrowseMealCog` 同時包含帳號／瀏覽功能，不能整個 cog 刪除。 |
| S02 | **學餐主系統只剩部分模型與相依**。無學餐 API、Web 頁面或 service 入口。 | [meal models 基準版](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/models/meal.py)（工作樹已由其他工作移除）；[應收款同步](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/receivable.py) 第 195 行、[privacy](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/privacy.py) 第 175 行 | 基準版 `MealOrder` 仍被既有應收款付款回寫與個資匯出使用；`sync_meal_order` 無正式呼叫。清理模型時須一併處理這些相依，不能直接 drop 表。 |
| S03 | **學餐周邊設定未清乾淨**。事件映射、失效連結、WS 房間、班級權限及 queue 訂閱仍在。 | [事件映射](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance_events.py) 第 88–92、113–114、131 行；[WS](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/routers/ws.py) 第 266 行；[班級預設](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/school_class.py) 第 65、70 行；各 `docker-compose*.yml` 的 worker `--queues` | `/meal`、`/meal/orders`、`/meal/vendor` 無 Web 路由。`class:meal_collect`、`class:meal_pickup` 及 `meal:manage` 不在現行 permission codes；Compose 仍訂閱 `meal`，但 Celery 已不宣告此 queue。不能把特約商家分類中的 `meal` 一併移除，那是「餐飲」分類。 |
| S04 | **舊主席公布編排服務整檔孤立**，357 行。 | [regulation_publication.py](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation_publication.py) 第 38 行 | 沒有正式／測試 import。現行 [router](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/routers/regulations.py) 第 271 行呼叫的是 [regulation.py](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) 第 1052 行的公布服務。舊檔仍編排審議轉移、公文與 outbox，屬另一套未接線流程。 |
| S05 | **舊法規手動維護流程仍留在 service**。起草、分支、修改、封存、廢止、刪除、條文編修、重排及修正對照等介面沒有正式引用。 | [regulation.py](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py)；完整 16 個函式見附錄 A；[舊匯入 wrapper](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation_import.py) 第 98、104 行 | 有些函式仍被單元測試呼叫，不能因測試存在就視為產品功能仍啟用。實測舊寫入路徑回 404／405；現行法規查詢、來源同步、公布、diff、列印仍在使用。`transition_workflow` 被 S04 呼叫，但這條鏈沒有應用入口。 |
| S06 | **治理中樞管理介面大幅停用，內部 CRUD 仍完整保留**。Matter／Program／Case 管理、資源、企劃書與版本附件、職務、決議、關聯圖、治理工作流模板、自動化規則管理與治理儀表板共 43 個公開介面未找到套件外正式呼叫。 | [治理套件匯出](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/__init__.py)、[matter](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py)、[planning](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py)、[relations](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_relations.py)、[events](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_events.py)；逐項見附錄 B | 無 `/governance` router／Web 頁面。但 `record_event` 仍被 workflow 與 ingest 呼叫，`run_automation` 仍會查詢並執行既有規則，`Matter`／`EntityRelation`／`Decision` 等仍有正式相依。可盤點管理介面的死碼，不能整包視為沒用或刪資料表。 |
| S07 | **治理 Discord 工作區的管理／同步發起介面無正式呼叫**。 | [governance_discord.py](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance_discord.py)：`upsert_workspace` 第 31 行、`list_routes` 第 49 行、`upsert_route` 第 65 行、`enqueue_workspace_sync` 第 89 行 | `get_workspace`、事件發送、同步結果回寫仍在用；一般 Discord 組織身分同步是另一套仍啟用的功能。這四個介面沒有接回現行管理 router。 |
| S08 | **活動／總召的管理寫入功能已無入口，讀取與授權仍在用**。 | [activity.py](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/activity.py) 第 82–173 行的 8 個函式，見附錄 A | 公開 `/activities` 是活動相簿列表，不能當成舊活動管理 API／詳情頁。`get_activity`、活動選單與 `can_manage_activity_resource` 仍被公文、問卷、公告、商店使用。後者 GitNexus 為 `CRITICAL`：14 個直接呼叫者、67 個受影響符號、20 個受影響流程。 |
| S09 | **舊活動工作區 schema 整檔孤立**，102 行。 | [schemas/activity_link.py](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/activity_link.py) | 9 個 schema 僅在檔內互相引用，無正式／測試 import。注意 [ActivityLink model](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/models/activity_link.py) 仍被 [context](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/context.py) 第 162 行查詢；只能先處理契約殘留。 |
| S10 | **活動／治理詳情連結仍指向已移除頁面**。 | [context.py](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/context.py) 第 38、98、181 行；[governance_discord.py](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance_discord.py) 第 203 行；[governance_ingest.py](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance_ingest.py) 第 459 行 | `/activities/{id}`、`/governance/{id}` 沒有對應頁面，也未找到 rewrite／redirect。若既有關聯或通知走到這些分支，會產生失效導覽；觸發頻率需另查實際資料。 |
| S11 | **銀行交易模型／輸出型別沒有業務接線**。 | [BankTransaction](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/models/finance.py) 第 543 行、[BankTransactionOut](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/finance.py) 第 795 行 | model 只有 `models/__init__.py` 註冊；未找到業務查詢／寫入、router 或 Web 呼叫，schema 不在 OpenAPI。屬未接線的銀行交易資料結構，不能據此否定整個財務系統，也未確認 DB 是否已有歷史資料。 |
| S12 | **代墊簽收單有 API 與測試，前端入口已斷**。 | [BudgetAdvanceReceipts](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/components/finance/BudgetAdvanceReceipts.tsx) 第 8 行；[finance API](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/lib/api/finance.ts) 第 148 行；[下載端點](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/routers/finance_claims.py) 第 423 行 | 元件只被 `budgetWorkbook.test.tsx` import；`exportAdvanceReceipt` 的正式呼叫也只來自該孤立元件。後端端點仍可直接呼叫，判定為前端未接線，不是後端端點不存在。 |
| S13 | **班籍更正申請的使用者填單介面已斷線**。 | [ClassCorrectionRequest](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/components/shop/ClassCorrectionRequest.tsx) 第 16 行 | 只有測試引用；後端申請／本人紀錄／審查 API 與管理端 [ClassCorrectionRequestsPanel](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/components/admin/ClassCorrectionRequestsPanel.tsx) 仍在使用。殘留的是使用者填單元件，不能整個更正系統刪除。 |
| S14 | **商品 Lookbook 展示鏈沒有頁面掛載**。 | [ShopLookbook](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/components/shop/ShopLookbook.tsx) 第 34 行、[shop-lookbook.ts](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/lib/shop-lookbook.ts) | 元件只有測試引用，資料工具只由這個元件與測試 import。CSS、JSON 與圖片準備／打包腳本仍保留；腳本可被人工執行，不能因此宣稱所有素材完全沒有用途。 |

### 學餐斷線的操作逐項對照

| 後端 operation | bot 呼叫位置（meal_commands.py） | 現況 |
| --- | --- | --- |
| `meal_order` | 第 31 行 | 無對應 handler |
| `meal_cancel` | 第 107 行 | 無對應 handler |
| `meal_today` | 第 195 行 | 無對應 handler |
| `meal_week` | 第 220 行 | 無對應 handler |
| `meal_orders` | 第 235 行 | 無對應 handler |
| `meal_cancel_choices` | 第 251 行 | 無對應 handler |

比對到 41 種 bot 的字面量 `_command` operation。初步字串比較也會把 `notify_get`
列為缺失；人工追查後已排除，因 [通知 handler](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/discord_command_notifications.py)
第 29 行使用 `startswith("notify_")` 分派。學餐沒有相同的動態分派。

## 二、前端 9 個孤立檔案

以 250 個 `src` 頁面／layout／route／錯誤頁／instrumentation 等慣例入口追蹤，
輔以 repo 內 import、dynamic import 與元件名稱引用核對。以下 9 檔共 1045 行，
不含相依 CSS、JSON、測試或素材。這不是 production bundle 大小。

| 編號 | 檔案 | 行數 | 引用證據 |
| --- | --- | --- | --- |
| F01 | [regulations/client.tsx](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/app/%28public%29/regulations/client.tsx) | 3 | 舊 re-export wrapper 無 import；page 已直接 import `RegulationSearch`。 |
| F02 | [BudgetAdvanceReceipts.tsx](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/components/finance/BudgetAdvanceReceipts.tsx) | 40 | 只有 `budgetWorkbook.test.tsx`。對應 S12。 |
| F03 | [ClassCorrectionRequest.tsx](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/components/shop/ClassCorrectionRequest.tsx) | 158 | 只有同名測試。對應 S13。 |
| F04 | [ShopLookbook.tsx](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/components/shop/ShopLookbook.tsx) | 155 | 只有同名測試。對應 S14。 |
| F05 | [PublicFileEmbed.tsx](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/components/site/PublicFileEmbed.tsx) | 77 | 未找到 import 或元件呼叫。 |
| F06 | [PublicSpotlightLink.tsx](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/components/site/PublicSpotlightLink.tsx) | 40 | 未找到 import 或元件呼叫。 |
| F07 | [Drawer.tsx](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/components/ui/Drawer.tsx) | 234 | 未找到 import 或元件呼叫；Drawer 樣式／舊設計筆記存在，不代表元件有掛載。共享樣式檔不能整檔刪除。 |
| F08 | [articleTree.ts](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/lib/articleTree.ts) | 305 | 整套舊條文樹編輯／拖曳工具未被 import；其匯出函式也無檔外呼叫。 |
| F09 | [shop-lookbook.ts](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/web/src/lib/shop-lookbook.ts) | 33 | 只由 F04 與同名測試 import；資料 JSON 另有人工打包腳本使用。 |

已排除 `PublicBudgetExecutionTable.tsx`、`PublicBudgetFinancialSummary.tsx`、
`publicBudgetExecution.ts`：它們仍由 `/public/budgets` 與其詳情頁使用。不能只用
「沒有被保護區頁面 import」作為未使用證據。

## 三、確實是舊系統，但目前有保留理由

以下內容不是「可直接刪除」：

| 項目 | 目前保留位置／原因 |
| --- | --- |
| 舊活動職務與 Discord 活動工作區 | [legacy_models.py](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/legacy_models.py) 的 `ActivityRole`、`ActivityMember`、`DiscordActivityWorkspace`，共 3 個 table 定義。 |
| 舊物資庫存與採購 | 同檔 `InventoryCategory`、`InventoryItem`、`InventoryTransaction`、`InventoryProcurement`、`InventoryProcurementItem`，共 5 個 table 定義。 |
| 舊客服／代操作／協助系統 | 同檔 `SupportTicket`、`SupportTicketEvent`、`SupportAuditLog`、`SupportApproval`、`SupportImpersonationSession`、`SupportAssistanceSession`、`SupportGuideEntry`，共 7 個 table 定義。 |

`legacy_models.py` 共 588 行，檔首明示是停用功能的 ORM metadata；
[Alembic env](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/alembic/env.py) 第 8 行仍 import 它，讓 schema drift 比對看得到
這 15 個舊 table 定義。API／Celery 的一般 import 不載入它。這些定義可作為資料退役
清單，但本次沒有查 DB 或執行資料刪除，不能直接移除 metadata 造成 autogenerate
誤判要 drop 表。

其他已排除的誤判：

- `*_tasks.py` 有字串註冊、beat 或任務發送入口，不能因沒有一般 import 就判定沒用。
- `_reload_sentinel.py` 被 [recovery.py](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/core/recovery.py) 作為檔案監看重載訊號。
- [libs/shared](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/libs/shared/README.md) 明示為未來多消費者保留的空骨架，沒有另一套正在跑的共用業務系統；根 README 仍把它描述為現有共用 schema，敘述偏舊。
- 舊 token／cookie、既有內容格式相容與財務歷史收入相容分支仍有正式呼叫或遷移用途；未列為可刪死碼。
- `SoftDeleteMixin` 仍被模組 scaffold 模板引用；獨立維護工具／部署腳本可能人工使用，不能只憑沒有 import 判定停用。

## 四、設定與工具殘留

| 項目 | 證據 | 判定 |
| --- | --- | --- |
| `RECOVERY_TASK_MAX_RETRIES` | [config.py](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/core/config.py) 第 215 行 | 正式程式只有宣告，未找到讀取；調整此欄位不會改變現行重試行為。 |
| `MODULE_CIRCUIT_COOLDOWN_SECONDS` | [config.py](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/core/config.py) 第 247 行 | 正式程式只有宣告，未找到讀取；不能當成目前斷路器的有效冷卻設定。 |
| 已刪 meeting service 的 Bandit 例外 | [apps/api/pyproject.toml](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/pyproject.toml) 第 77 行仍列 `services/meeting/_voting.py:B105` | 路徑不存在，屬失效設定。 |
| `meal` queue 訂閱 | 四份 Compose 仍訂閱；[celery_app.py](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/core/celery_app.py) 的 `task_queues` 已無 `meal` | 屬學餐退役後的部署設定殘留。queue topology 檢查只保證所需 queue 有 consumer，通過不能證明每個訂閱 queue 都有 producer。 |
| `documents` queue | Celery 有宣告，Compose 有訂閱，但本次未找到 task route 或明確發送指定此 queue | 僅列次級候選；需確認外部人工 `send_task`、broker 留存任務與部署習慣，未判定可移除。 |

## 五、建議處理順序

1. 先處理使用者看得到的斷線：S01 學餐指令、S10 失效詳情連結，以及 S12／S13 要恢復還是退役的使用者入口。
2. 再清理沒有業務入口的純程式：S04、F01／F05／F06／F08，以及確認退役後的 F02／F03／F04／F07／F09；相依測試、CSS、工具與素材分別核對。
3. 按功能移除舊法規與治理管理 service／schema；保留現行公布、來源同步、workflow、ingest、事件與活動授權相依。
4. 資料層另立退役工作：先查舊表資料與 FK／匯出／稽核需求，再設計 migration。不要用刪 model 取代資料退役。

本次只新增盤點報告，沒有刪除或停用任何上述功能。

## 六、實跑證據與限制

| 檢查 | 結果 |
| --- | --- |
| 任務開始 `git status --short` | 乾淨。 |
| `node .gitnexus/run.cjs status` | 索引 commit 與 `61aa0ee1` 相符；涵蓋檔案內容相符。後續其他來源修改未算入本報告基準。 |
| GitNexus query／context／impact（均 `--repo .`，同名函式帶 `--file`） | 舊公布服務、`create_matter` upstream 為 0，但 risk 為 `UNKNOWN`；已補查引用／掛載／測試，不把零邊當低風險。活動授權為 `CRITICAL`，此處只分析，未改它。 |
| Python AST、Web import 可達性與字面量交叉檢查 | 以基準 commit 重算；附錄保存逐項候選。不是執行期覆蓋率，也不涵蓋外部消費者。 |
| 解析追蹤中的 OpenAPI 快照 | 724 個 path；無 `/meal`、`/activities`、`/governance`、`/inventory`、`/support` API namespace。`/workflows` 仍有 5 個 path，不能判成整套停用。30 個附錄 C schema 均不在快照。 |
| `npm run --prefix apps/web check:module-registry` | exit 0，20 個 module ID 一致。這不代表模組內每個元件都有使用。 |
| `python3 scripts/validate-celery-topology.py` | exit 0，四份 Compose 的所需 queue 均有 consumer；不驗 producer 活躍度。 |
| `PYTHONPATH=apps/api/src .venv/bin/python -m pytest scripts/tests/test_regulation_surface.py -q` | 首次收集失敗：執行環境的 `DEBUG` 無法解析為 bool，未改程式。 |
| `DEBUG=false PYTHONPATH=apps/api/src .venv/bin/python -m pytest scripts/tests/test_regulation_surface.py -q` | exit 0，3 passed、13 subtests passed，驗舊法規入口退役與公布登入限制；有既有 pytest 外掛 deprecation warning。 |
| `bash scripts/check.sh doctor` | exit 1：WSL 缺 Docker，Codex CLI 自檢失敗；其他必要靜態工具可用。這不影響本次引用盤點。 |
| `bash scripts/check.sh docs` | exit 1：其他來源把 shop router 拆為套件，既有本機 `PROJECT_CONTEXT.md` 仍連到已移除的 `routers/shop.py`。沒有為了通過本次檢查而修改他人的拆分或原有文件。 |
| 報告自身連結與附錄核對 | 165 個本機相對連結可解析；39／43／30 個附錄符號的位置均與基準版 AST 相符。外部連結指向本機已確認的 Git commit，未測 GitHub 登入／可達性。 |
| 提交前 `bash scripts/check.sh graph` | 沙箱首次因 `spawnSync git EPERM` 失敗；沙箱外重跑 exit 0。包含其他工作的 migration 整理、學餐清理與商店拆分，整體為 `critical`；CLI 當次為 294 檔／318 符號，後續 MCP 為 295 檔／321 符號、64 流程，未回報 partial／truncated。這不是對他人變更的審核通過。 |
| GitNexus `detect-changes --scope staged --repo .` | 本次 stage 只有報告 1 檔，沒有可對應的索引符號；文件屬 `UNKNOWN`，由連結、內容與附錄逐項核對補驗，不宣稱圖譜已涵蓋文件。 |
| `git diff --check`／`git diff --cached --check` | 通過；提交範圍只有本報告。 |
| DB／migration／正式站流量／完整 API 與 Web regression | 未跑；本次無執行程式變更，也未讀正式資料。不能以本報告宣稱全站測試通過或舊表可直接刪除。 |

附錄中的「測試引用節點」計入 import／名稱／屬性／同名字串，**不是測試案例數**。
附錄 A 是較保守的候選集合：若另一個模組剛好使用同名函式，可能遮蔽更多候選；
治理介面另外追到 import alias，已排除陳情服務的同名 `create_case`／`get_case` 與
一般儀表板的同名符號。附錄 B 的 re-export 不算正式業務使用。

## 附錄 A：39 個未找到正式引用的服務函式

| 編號 | 位置 | 函式 | 測試引用節點 |
| --- | --- | --- | --- |
| A01 | [services/activity.py:82](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/activity.py) | `create_activity` | 0 |
| A02 | [services/activity.py:90](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/activity.py) | `update_activity` | 0 |
| A03 | [services/activity.py:103](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/activity.py) | `archive_activity` | 0 |
| A04 | [services/activity.py:111](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/activity.py) | `appoint_convener` | 0 |
| A05 | [services/activity.py:137](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/activity.py) | `list_conveners` | 0 |
| A06 | [services/activity.py:147](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/activity.py) | `get_convener` | 0 |
| A07 | [services/activity.py:156](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/activity.py) | `update_convener` | 0 |
| A08 | [services/activity.py:171](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/activity.py) | `remove_convener` | 0 |
| A09 | [services/google_tasks_service.py:178](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/google_tasks_service.py) | `delete_google_task` | 0 |
| A10 | [services/mail.py:522](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/mail.py) | `send_email_now` | 3 |
| A11 | [services/notification_pref.py:224](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/notification_pref.py) | `is_module_muted` | 0 |
| A12 | [services/official_print.py:786](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/official_print.py) | `render_regulation_amendment_comparison_html` | 0 |
| A13 | [services/outbox.py:708](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/outbox.py) | `replay_dead_event` | 0 |
| A14 | [services/partner_map.py:611](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/partner_map.py) | `count_active_offers` | 0 |
| A15 | [services/permission.py:190](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/permission.py) | `get_org_permission_codes` | 0 |
| A16 | [services/permission.py:323](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/permission.py) | `user_has_permission` | 3 |
| A17 | [services/receivable.py:195](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/receivable.py) | `sync_meal_order` | 0 |
| A18 | [services/regulation.py:492](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `create_regulation` | 2 |
| A19 | [services/regulation.py:840](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `fork_regulation_draft` | 2 |
| A20 | [services/regulation.py:940](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `update_regulation` | 3 |
| A21 | [services/regulation.py:1010](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `structure_regulation_content` | 2 |
| A22 | [services/regulation.py:1100](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `archive_regulation` | 1 |
| A23 | [services/regulation.py:1116](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `repeal_regulation` | 1 |
| A24 | [services/regulation.py:1146](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `delete_regulation` | 1 |
| A25 | [services/regulation.py:1205](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `update_article` | 1 |
| A26 | [services/regulation.py:1242](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `delete_article` | 1 |
| A27 | [services/regulation.py:1282](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `get_article` | 0 |
| A28 | [services/regulation.py:1307](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `update_regulation_metadata` | 0 |
| A29 | [services/regulation.py:1329](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `update_regulation_revision` | 0 |
| A30 | [services/regulation.py:1497](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `list_workflow_logs` | 1 |
| A31 | [services/regulation.py:1513](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `reorder_articles` | 1 |
| A32 | [services/regulation.py:1538](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `auto_renumber_articles` | 0 |
| A33 | [services/regulation.py:1588](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation.py) | `compare_amendment` | 1 |
| A34 | [services/regulation_import.py:98](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation_import.py) | `parse_regulation_docx` | 4 |
| A35 | [services/regulation_import.py:104](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/regulation_import.py) | `parse_regulation_pdf` | 0 |
| A36 | [services/school_class.py:1243](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/school_class.py) | `remove_manual_member` | 0 |
| A37 | [services/survey.py:522](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/survey.py) | `archive_survey` | 0 |
| A38 | [services/task_inbox.py:515](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/task_inbox.py) | `task_count_from_inbox` | 0 |
| A39 | [services/work_item.py:60](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/work_item.py) | `list_work_items_by_source` | 0 |

## 附錄 B：43 個沒有套件外正式呼叫的治理服務介面

治理套件仍使用中的 `record_event` 不在本表。以下有些彼此呼叫或有測試；判定是
缺少套件外的正式業務入口，不是連函式內部引用都沒有。

| 編號 | 位置 | 介面 |
| --- | --- | --- |
| B01 | [services/governance/_events.py:57](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_events.py) | `create_timeline_event` |
| B02 | [services/governance/_events.py:72](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_events.py) | `create_matter_task` |
| B03 | [services/governance/_events.py:88](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_events.py) | `create_decision` |
| B04 | [services/governance/_events.py:106](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_events.py) | `get_decision` |
| B05 | [services/governance/_events.py:110](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_events.py) | `update_decision` |
| B06 | [services/governance/_matter.py:64](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `get_matter_by_slug` |
| B07 | [services/governance/_matter.py:99](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `list_matters` |
| B08 | [services/governance/_matter.py:163](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `get_matter` |
| B09 | [services/governance/_matter.py:186](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `create_matter` |
| B10 | [services/governance/_matter.py:201](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `update_matter` |
| B11 | [services/governance/_matter.py:228](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `create_matter_resource` |
| B12 | [services/governance/_matter.py:249](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `get_matter_resource` |
| B13 | [services/governance/_matter.py:253](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `update_matter_resource` |
| B14 | [services/governance/_matter.py:269](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `delete_matter_resource` |
| B15 | [services/governance/_matter.py:285](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `create_program` |
| B16 | [services/governance/_matter.py:302](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `update_program` |
| B17 | [services/governance/_matter.py:318](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `get_program` |
| B18 | [services/governance/_matter.py:322](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `create_case` |
| B19 | [services/governance/_matter.py:339](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `get_case` |
| B20 | [services/governance/_matter.py:343](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_matter.py) | `update_case` |
| B21 | [services/governance/_planning.py:45](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `create_planning_document` |
| B22 | [services/governance/_planning.py:89](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `get_planning_document` |
| B23 | [services/governance/_planning.py:105](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `update_planning_document` |
| B24 | [services/governance/_planning.py:124](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `create_planning_revision` |
| B25 | [services/governance/_planning.py:202](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `get_planning_attachment` |
| B26 | [services/governance/_planning.py:208](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `attachment_is_referenced` |
| B27 | [services/governance/_planning.py:219](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `create_role_assignment` |
| B28 | [services/governance/_planning.py:236](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `get_role_assignment` |
| B29 | [services/governance/_planning.py:242](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `update_role_assignment` |
| B30 | [services/governance/_planning.py:262](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `create_workflow_template` |
| B31 | [services/governance/_planning.py:271](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `list_workflow_templates` |
| B32 | [services/governance/_planning.py:280](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `create_automation_rule` |
| B33 | [services/governance/_planning.py:289](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `list_automation_rules` |
| B34 | [services/governance/_planning.py:301](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `get_automation_rule` |
| B35 | [services/governance/_planning.py:305](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `update_automation_rule` |
| B36 | [services/governance/_planning.py:313](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_planning.py) | `dashboard` |
| B37 | [services/governance/_relations.py:16](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_relations.py) | `create_relation` |
| B38 | [services/governance/_relations.py:42](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_relations.py) | `create_entity_relation` |
| B39 | [services/governance/_relations.py:72](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_relations.py) | `list_entity_relations` |
| B40 | [services/governance/_relations.py:97](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_relations.py) | `entity_relation_graph` |
| B41 | [services/governance/_relations.py:140](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_relations.py) | `list_relations_for_target` |
| B42 | [services/governance/_relations.py:157](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_relations.py) | `get_relation` |
| B43 | [services/governance/_relations.py:161](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/services/governance/_relations.py) | `delete_relation` |

## 附錄 C：30 個未找到正式引用且不在 OpenAPI 的 schema

這是「沒有正式 Python 引用」的候選根節點清單。僅被這些節點或死服務引用的子型別
未全部重複計數；例如 S09 檔內另有互相引用的 schema。

| 編號 | 位置 | Schema |
| --- | --- | --- |
| C01 | [schemas/activity.py:78](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/activity.py) | `ActivityConvenerOut` |
| C02 | [schemas/activity_link.py:13](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/activity_link.py) | `ActivityLinkCreate` |
| C03 | [schemas/activity_link.py:63](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/activity_link.py) | `ActivityWorkspaceOut` |
| C04 | [schemas/activity_link.py:79](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/activity_link.py) | `ActivityClosingReportOut` |
| C05 | [schemas/activity_link.py:88](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/activity_link.py) | `ActivitySpawnCreate` |
| C06 | [schemas/activity_link.py:98](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/activity_link.py) | `ActivitySpawnOut` |
| C07 | [schemas/auth.py:8](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/auth.py) | `TokenPair` |
| C08 | [schemas/auth.py:16](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/auth.py) | `TokenPayload` |
| C09 | [schemas/auth.py:23](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/auth.py) | `RefreshRequest` |
| C10 | [schemas/email_platform.py:211](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/email_platform.py) | `EmailSampleSendInput` |
| C11 | [schemas/finance.py:795](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/finance.py) | `BankTransactionOut` |
| C12 | [schemas/finance.py:806](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/finance.py) | `FinanceDashboardOut` |
| C13 | [schemas/governance.py:299](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/governance.py) | `EntityRelationGraphOut` |
| C14 | [schemas/governance.py:415](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/governance.py) | `GovernanceModuleCapabilityOut` |
| C15 | [schemas/governance.py:427](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/governance.py) | `GovernanceResourceSearchOut` |
| C16 | [schemas/governance.py:509](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/governance.py) | `GovernanceWorkflowTemplateOut` |
| C17 | [schemas/governance.py:524](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/governance.py) | `AutomationRuleOut` |
| C18 | [schemas/governance.py:542](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/governance.py) | `MatterSpawnIn` |
| C19 | [schemas/governance.py:550](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/governance.py) | `MatterSpawnOut` |
| C20 | [schemas/governance.py:557](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/governance.py) | `MatterLinkRefOut` |
| C21 | [schemas/governance.py:594](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/governance.py) | `MatterOut` |
| C22 | [schemas/governance.py:636](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/governance.py) | `GovernanceDashboardOut` |
| C23 | [schemas/partner_map.py:414](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/partner_map.py) | `PartnerMapBounds` |
| C24 | [schemas/publication.py:40](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/publication.py) | `PublicationDeliveryOut` |
| C25 | [schemas/regulation.py:108](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/regulation.py) | `ArticleMoveRequest` |
| C26 | [schemas/regulation.py:153](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/regulation.py) | `RegulationRevisionCreate` |
| C27 | [schemas/regulation.py:301](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/regulation.py) | `RegulationArchiveRequest` |
| C28 | [schemas/regulation.py:307](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/regulation.py) | `RepealRegulationRequest` |
| C29 | [schemas/regulation.py:340](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/regulation.py) | `AutoRenumberRequest` |
| C30 | [schemas/regulation.py:360](https://github.com/Tedhuang6666/hcca_web_system/blob/61aa0ee1dfba8b3046c9c05dd50e98aac5a1b369/apps/api/src/api/schemas/regulation.py) | `AmendmentComparisonExportRequest` |
