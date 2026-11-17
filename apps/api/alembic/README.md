# Migration 基線

`archive/` 的 277 個 revisions 內容不變，仍由 `alembic.ini` 載入，供舊資料庫辨識與升級。
新 revisions 放 `versions/`；使用 `revision --version-path alembic/versions`。

- 舊資料庫：照常 `alembic upgrade head`，不需手動 stamp。
- 空資料庫：`alembic -x baseline=true upgrade head`，跳過歷史重播。
  旗標遇到已有 revision 的資料庫會沿原鏈升級；遇到無 revision 的非空 schema 會拒絕執行。
- 完整歷史回歸：在另一個空測試庫執行 `alembic upgrade head`，與基線庫比較 schema 和種子資料。
- 離線新庫 SQL：`alembic -x baseline=true upgrade head --sql`。
- 基線及學餐移除會拒絕 downgrade。套用學餐移除前須備份；不以重建空表冒充資料復原。

`baseline/20261117020000.sql.gz` 來自只套用歷史 migrations 與學餐移除的空 PostgreSQL 16，
包含 schema、序號、trigger、索引及 migration 種子資料，不含應用資料與 alembic_version。
保留 pg_dump 的註解、空行與種子字串內容，只移除 psql restrict 指令及 search_path 清除指令；
將 `public.` 改為 schema 佔位符，
以支援測試 worker 的隔離 schema。壓縮設定 `mtime=0`，解壓 SHA-256 固定在基線 revision。
可用 `gzip -dc alembic/baseline/20261117020000.sql.gz` 審閱 SQL。不要從開發或正式庫重建此檔。

`20261117030000` 另外移除已退役的活動工作區、庫存、客服、銀行交易、企劃書與
治理管理表，共 24 表，並移除治理案件的舊專案關聯欄位。保留工作流、事件引擎、
活動授權、歷史應收款與稽核資料；不修改基線或封存歷史。
此 revision 會拒絕 downgrade；正式套用需另行核准與備份。
