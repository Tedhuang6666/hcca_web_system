# 舊系統殘留清除結果（2026-11-17）

基準 `bd0a01ed`，獨立工作樹 `hcca-residue-cleanup`，分支
`refactor/unused-systems-cleanup`。本次依[原盤點](UNUSED_SYSTEMS_20261117.md)
逐項清除；原報告的來源連結已固定到盤點 commit，避免刪檔後失效。

## 逐項處置

| 項目 | 結果 |
| --- | --- |
| S01 Discord 學餐指令 | 移除 4 個 slash command、3 個選單類別及斷線操作；保留帳號連結／解除與公告、問卷、法規瀏覽。Cog 更名為 `AccountBrowseCog`，loader 改用 `account_commands.py`。 |
| S02 學餐模型與相依 | 本次基準已完成 ORM、一般業務相依與表的退役；核對後未重複修改該 migration。歷史應收款來源與稽核事件分類保留，以讀取既存歷史。 |
| S03 學餐周邊殘留 | 移除剩餘事件映射、失效 href、實體標籤、班級預設權限與 bot 結單標籤。`meal` queue 訂閱在基準已清除。商家「餐飲」分類保留。 |
| S04 舊法規公布服務 | 刪除整個孤立的 `regulation_publication.py`，現行 router 呼叫的公布服務保留。 |
| S05 舊法規手動寫入流程 | 清除 16 個公開介面、8 個僅由死碼呼叫的 helper、無效狀態常數、舊匯入 wrapper 與其專用 schema／測試。29 個保留的法規 service 函式 AST 與基準相同。 |
| S06 治理管理 CRUD | 清除原附錄 B 的 43 個介面、企劃／關聯管理模組與全部孤立管理 schema；治理套件僅匯出仍有正式呼叫的 `record_event`。保留 ingest、自動化引擎、規則資料與工作流相依。 |
| S07 治理 Discord 管理 | 移除 4 個未接線管理／同步發起介面。工作區讀取、既有結果回寫與事件發送保留。 |
| S08 活動／總召管理 | 清除 8 個未接線寫入／管理介面與專用請求型別。保留 Activity、ActivityConvener、選單／讀取及既有物件範圍授權。 |
| S09 舊活動工作區 | 刪除 ActivityLink ORM／schema、context 讀取與清空訂單中的無效關聯刪除；以明確 migration 退役該表。 |
| S10 失效詳情連結 | context 不再產生活動／事項詳情連結，移除對應空殼輸出欄位；治理通知只使用已提供的 href，不再補出不存在的頁面。 |
| S11 銀行交易空殼 | 移除 BankTransaction ORM／schema，表納入資料退役。 |
| S12 代墊簽收單 | 移除孤立元件、HTTP endpoint、API client、DOCX renderer／helper 與專用測試；預算 Excel 匯出及正式費用申請／帳務流程保留。 |
| S13 班籍更正填單元件 | 刪除未掛載的 ClassCorrectionRequest 元件與其測試／專用 CSS；後端申請 API 與管理審查介面保留。 |
| S14 商品 Lookbook | 刪除未掛載展示元件、工具、JSON、專用 CSS／測試、圖片準備與打包腳本。未操作上傳資料或本機未追蹤素材。 |
| F01–F09 | 9 個原孤立檔案目前均不存在；Drawer 在本次基準已刪，本次清除剩餘專用 CSS。共享 CSS 的有效 selector 與宣告經 AST 比對保持一致。 |
| A01–A39 | 原附錄 A 的 39 個符號於原路徑均不存在；其中學餐同步已由基準退役。郵件與 RBAC 測試改驗現行 provider／權限 helper。 |
| C01–C30 | 原附錄 C 的 30 個 schema 根節點及僅被死碼依賴的型別已清除；生成 bridge 的失效 alias 一併移除。 |
| 舊庫存／客服／活動角色 metadata | 刪除 legacy_models 與 Alembic 載入；15 張表由已核准 migration 明確退役。 |
| 設定與 queue | 清除 2 個未讀取 Settings 欄位、公開環境範例／schema、失效 meeting Bandit 例外。移除沒有 producer 的 documents queue 宣告、4 份 Compose 訂閱與 metrics 標籤。 |

## 資料退役與保留範圍

使用者已明確核准[24 張表及 program_id 的退役方案](UNUSED_SYSTEMS_CLEANUP_PLAN_20261117.md)，
授權限於建立 migration 與本機可丟棄 PostgreSQL 驗證。
新增 `20261117030000`，沿外鍵順序刪表，不使用 CASCADE；先移除
`governance_cases.program_id`，保留案件與 Matter。歷史資料不能從空 schema 重建，
`downgrade` 明確拒絕並要求從備份復原。

封存 migration 與靜態基線未修改。完整封存歷史、新庫 baseline 與離線 SQL 三種
建立方式得到相同 head schema／種子；測試確認 24 表及欄位消失、現行案件仍保留，
且被拒絕的 downgrade 不改 revision。專門驗證封存商店 split 的案例使用獨立的
退役前 schema，保留價格、庫存、折扣與會計斷言，交易結束後回滾整個 schema。

仍被呼叫的活動授權、法規公布／來源同步、工作流／覆核、治理事件與自動化、
應收款歷史來源、一般稽核、班籍更正審查及預算 Excel 不是殘留，保留其業務規則。
本次未連正式資料庫，未部署、未啟停正式 Compose、未推送；正式資料尚未套用此 migration。

## 驗證證據

| 檢查 | 本次實跑結果 |
| --- | --- |
| `bash scripts/check.sh api` | Ruff、格式、mypy gate、4 份 queue topology 與 3 個 Gunicorn runtime 測試通過。 |
| `bash scripts/check.sh api-test --cov --cov-report=term-missing --cov-report=xml -q` | **2953 passed**，PostgreSQL 真實資料庫；coverage **73.31%**，原門檻 72% 保持不變。156 個既有 warning。 |
| `pytest scripts/tests/test_regulation_surface.py -q --no-cov` | **3 passed、13 subtests passed**，確認舊寫入入口退役與現行公布需登入。 |
| `scripts/tests/test_migration_baseline.py` | **1 passed**；完整歷史／baseline／offline SQL 相等，驗退役、現行案件保留與拒絕假 downgrade。 |
| `alembic -x baseline=true upgrade head`／舊 revision upgrade／`alembic check` | 自建本機 PostgreSQL 16.15 通過；升級前、升級後均無 drift。額外查 catalog 確認 revision 為 `20261117030000`，24 表及 `program_id` 均不存在。 |
| `bash scripts/check.sh web` | lint、20 個 module registry、type-check 與 **161 檔／941 個測試通過**；statements 30.22%、branches 31.03%、functions **26.05%**、lines 30.71%，原門檻及逐檔 gate 未修改。首跑 build 受下述 Next.js 安全提示中止。 |
| 原參數重跑 `npm run --prefix apps/web build` | **exit 0**，production 編譯、TypeScript、靜態頁與 route manifest 完成；保留安全更新警示。 |
| Discord bot unittest／Ruff | 獨立 bot interpreter **2 tests OK**；驗保留的 5 個帳號／瀏覽指令與 loader 不再載入學餐 slash commands；lint／format 通過，沒有登入 Discord 或發送訊息。 |
| `bash scripts/check.sh contract` | 重建 OpenAPI 型別後 diff 為空；`api-types.ts` 與 `api-bridge.ts` 由生成器更新。OpenAPI JSON 為既有忽略產物，未新增大型生成檔到 Git。 |
| CSS AST 比對 | 六份共享 CSS 的有效 selector／宣告與基準完全一致；只移除孤立元件專用 selector，保留現行商店班籍切換樣式。 |
| Playwright 真實 Chromium | 法規桌面 1440×1000、手機 390×844；鍵盤送出查詢、無結果狀態、手機導覽開啟與 Escape 關閉均可操作。商品及公開預算手機頁可載入，三頁均無水平溢出。法規／公開預算最後主控台 0 error；商品訪客的 `/auth/me` 回 401 為既有登入探測。 |
| Compose config | 4 份修改檔及其 infrastructure extends 的原始位元組與暫存驗證副本一致，standalone Compose `config --quiet` 全部通過；使用虛構值，沒有啟動服務。 |
| docs／debt | 兩個 gate 均通過；維護技能中原有失效的 LOCAL_TOOLING 文件連結已改為 ENVIRONMENT。原盤點 166 個來源引用／63 個 Git 物件與交付文件本機連結逐一驗證。 |
| GitNexus `detect-changes --scope all --repo .`＋MCP | 暫存 **105 檔／84 個符號／140 條流程**，風險為 **critical**；MCP 完整回傳 84／140 筆，無 partial／truncated 標記。圖譜納入變更附近未改內容的符號，另以 AST 確認實際函式差異。 |
| 最終差異與 stage | `git diff --check`、`git diff --cached --check` 通過；只有本次相關程式、測試、契約、設定及報告。主工作樹維持乾淨。 |

本次先修復測試假設，再重跑完整回歸：歷史商店 migration 原先共用最新 schema，
因退役表已不存在而失敗；改用隔離舊 schema 後，原業務斷言全部通過。
前端起初 937 項通過但 functions coverage 為 25.99%，補現行 Excel 匯出 loading／
失敗恢復、下載生命週期與過期登入重試後，941 項與原 gate 全部通過。
瀏覽器初次 WS 403 是本機測試網址與 Origin 未對齊；明確設定本機允許來源後，
WebSocket 正常 accepted，沒有修改來源驗證規則。

Build 首跑出現 Next.js **16.4.1** 的 `SecurityFatalError` 更新提醒。
依[官方提醒機制](https://github.com/vercel/next.js/blob/canary/docs/01-app/03-api-reference/05-config/01-next-config-js/agentUpgrade.mdx)
重跑原指令即成功，沒有關閉提醒或改依賴；**仍建議另行升級至安全修補版本**。
Sentry build 因未提供 token 而未建立 release／上傳 sourcemap，符合本機驗證環境。

## 圖譜與限制

修改前對既有符號逐一做 GitNexus impact，同名符號限定檔案；UNKNOWN 使用 AST、
字面量引用、實際掛載、OpenAPI 與測試補查。Settings 為 CRITICAL（86 個直接匯入），
此次只刪 2 個未使用欄位；治理通知／自動化 action 的修改只移除失效 href fallback。
高影響的活動資源授權保持原樣。分析器的流程追蹤存在預設預算上限，圖譜結果不是
執行期完備性證明；刪除候選均另核對原始碼引用與正式入口。

本機 PostgreSQL 16.15、Redis 與 API 全為本次獨立實例；沒有讀取正式 secrets。
Compose 僅以原始設定檔、公開範例與虛構驗證值做 config 檢查，未啟動 Docker 容器。
外部未納入 repository 的 consumer／人工 broker 任務與正式流量無法由本機測試證明；
正式套用仍須先備份並另行核准。
