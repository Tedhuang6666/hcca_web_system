# 技術債修復紀錄

2026-11-17：從使用者的 DEBT-01～12 清單核對並執行。這是分批修復紀錄，不宣稱全庫債務歸零。
未更動正式資料庫、未部署、未 push。規範與此紀錄納入版本控制。

## 已實作與驗收邊界

| ID | 這批處理 | 剩餘 |
| --- | --- | --- |
| DEBT-01 | 將 2,915 行校商 router 拆成 17 個檔案，各檔少於 600 行；依原順序掛載，OpenAPI 相同 | petitions、admin_system、finance_budget、其他巨型 service／前端仍待分領域拆分 |
| DEBT-02 | 校商 router 不再直接操作 SQLAlchemy 查詢；購買者身分與班級範圍下移 service，HTTP 層保留錯誤映射與權限入口 | 其他 router 的查詢與 11 個 service 的 HTTPException 依賴仍待處理 |
| DEBT-03 | 校商訂單變更以同交易 outbox 持久化，提交後喚醒 worker；回滾不廣播，broker 失敗交由既有重試 | 其他領域的 commit 邊界尚未統一；不能直接移除 get_db 的自動 commit |
| DEBT-04 | pytest 不再預設 SQLite，先選測試 DB 再載入 app；PostgreSQL fixture 使用 migration schema；mypy gate 從 10 檔增至 13 檔；後端門檻從 50 提高至 72；前端從 4 檔改為全部來源量測，保留原四檔門檻 | 整體前端 coverage 約 30%，各領域仍需補行為測試；transport mock 與 DB mock 應區分，不能以總數判斷測試品質 |
| DEBT-05 | 核對出現有 useFetch／api-cache 已有快取、去重與取消；未再引入第二套快取 | 既有手寫 useEffect 頁面仍需逐頁遷移；SSR 需另驗身份、快取鍵與個人資料隔離 |
| DEBT-06 | 新增逐檔 inline style 不得增加的 CI gate | tokens、兩個介面脈絡的色票、CSS 與設計文件仍需專案級整理及瀏覽器驗證 |
| DEBT-07 | 移除學餐模型、查詢／個資匯出／保存規則／WebSocket 房間與 queue 消費殘留；移除無引用 Drawer，清理空目錄 | 購物車與 checkout 仍由既有測試使用；退款與歷史來源 enum 不應只因目前沒有賦值就破壞契約 |
| DEBT-08 | 277 個 revision 原文封存至 archive；新增學餐移除與靜態基線，保留舊庫升級；空庫可跳過歷史重播；基線與完整歷史 schema／種子比較驗證 | 既有歷史 no-op downgrade 保存在封存鏈；新基線及資料移除會明確拒絕假還原，需備份復原 |
| DEBT-09 | 逐檔限制新增 broad except、Any、noqa、type ignore、service HTTPException、commit 與 router DB 查詢；個資訂單匯出不再吞例外 | 既有 broad except 與型別債仍須按失敗語意逐一清理 |
| DEBT-10 | 正式環境的 DB／PgBouncer／Redis 共用 infrastructure 定義；對齊現有 Compose 的映像版本，新增完整 config／版本一致性 CI | API／worker 的環境設定仍有重複；config 驗證不等同容器 runtime 或升級驗證 |
| DEBT-11 | 移除 19 筆失效 worktree 登錄，保留 9 個現存工作樹；清除 24 個過期索引重建暫存，回收約 4.05 GiB | 列印與 OG 字型仍有實際呼叫者，不直接刪除；其他輸出與工作樹需依使用情況另清理 |
| DEBT-12 | 共同 AGENTS／CLAUDE／專案地圖／維護流程與 hcca skill 納入版本控制，CI 要求存在且已追蹤；本次使用獨立分支 | 遠端分支保護與既有並行工作的流程需另行設定，不在此次推送或修改遠端設定 |

## 固定驗證入口

- `bash scripts/check.sh debt`：以 `config/technical-debt-baseline.json` 限制逐檔債務增加。
  `python3 scripts/check-technical-debt.py --ratchet` 只接受下降，不能用來放寬既有債務。
- `python3 scripts/validate-compose.py`：只用暫存變數與空 env 檔驗證六份 Compose，不讀取實際 service env。
  映像版本由 `config/compose-images.json` 約束；本機可用 `--compose-binary` 指定獨立 CLI。
- `uv run --locked --project apps/api python -m unittest discover -s scripts/tests -p 'test_migration_baseline.py'`：
  明確指定本機 PostgreSQL `*_test`；僅建立與刪除本次新建的三個隨機測試庫。
- `bash scripts/check.sh api-test`：PostgreSQL 行為回歸；實際 DB 不 mock。
- `bash scripts/check.sh api`、`web`、`contract`、`docs`、`graph`：依驗證矩陣執行。

統計腳本與原稽核的定義不同：router DB calls 只計接收者為 db／session 的 AST 呼叫，
Any 計 AST Name，長檔以超過 600 行計。不能直接把新舊數字相減當成已刪除數量。
目前基線仍有 router DB calls、commits、broad except 與大量 inline styles；CI gate 是防止繼續惡化，
不是修復完成證明。

## 影響分析

校商 114 個既有函式在拆分前執行 upstream impact。商品／管理權限共用函式含 CRITICAL，
依原邏輯搬移，補查動態路由註冊、直接引用與測試；不以無 caller 的 UNKNOWN 判為低風險。
outbox 分派、學餐模型、應收款同步與統計查詢另行 impact。
Compose、靜態基線及部分設定為 UNKNOWN，以實際解析、完整前後設定比對、PostgreSQL 升級及 schema 比較補驗。
提交前 detect-changes 回傳 257 個變更符號、81 條受影響流程，風險為 CRITICAL；
完整符號／流程列表已審閱，未回報 partial／truncated。這不是零風險或全部分支已覆蓋的聲明。

## 這批實跑結果

- PostgreSQL 全後端：2,974 passed，行覆蓋 73.03%，72% gate 通過。
- 前端：163 檔／948 項測試通過；678 檔來源的行覆蓋 30.79%；type-check、lint、build 通過。
  ESLint 與套件仍有既有 warnings，不表示零警告。
- API Ruff／format、mypy 13 檔、worker recycling、Celery 拓撲、契約產物比對通過。
- 六份 Compose config／映像一致性通過；完整設定前後比對只包含已宣告的版本對齊與移除 meal queue。
- ORM `alembic check` 無新增 upgrade operations；新庫線上基線、舊庫完整歷史、離線 SQL 三者 schema／種子相等。
- 文件與入口檢查、債務 gate、git diff 格式檢查通過。GitNexus 完整重建仍有既有跨語言／流程採樣限制，
  不以不存在的流程當成沒有影響；端點／權限由契約及 PostgreSQL 回歸補驗。
