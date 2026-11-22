# 預算與收支簡化交接

2026-11-14。範圍為 `/finance`、公開預算頁及財務憑證；獨立的班級／校商收款不在本次範圍。

## 行為與資料

後台保留上傳更新、實際收支登記及公開設定；移除核銷、提案、請購、覆核、科目、保管點及代墊單操作入口，保留歷史資料及相容服務。

完整上傳優先讀取「更新後總預算／預算總表／總預算」，依同帳本、同期間更新既有預算。完整版本取代規劃基線，新增模式才累加；實際收支與收據保留。關閉期間禁止更新。

支援正收入、負支出及舊版底色分類。提供檔實測 46 筆支出、10 筆收入，未略過明細。既有整數元儲存下，支出 342,609 元、收入 342,119 元；原檔小數金額／單價記於備註。

收入直接登記金額、日期與內部備註；原預算收入按鈕產生的已過帳傳票亦可查閱，不複製或重複計入。公開收入只提供項目、日期、金額，不含內部備註或操作人識別；新總表移除的收入項目仍保留歷史收款。

公開財務直接讀取最新 API。開啟支出明細即渲染 PDF，提供淺色預覽、翻頁、縮放及原檔連結。

## 上線必要條件

先套用 `apps/api/alembic/versions/20261114160000_budget_income_records.py`。本次未部署、未操作正式資料。未設定可用 PostgreSQL 測試資料庫，尚未驗證 PostgreSQL upgrade 與 Alembic drift；SQLite migration upgrade/downgrade 及 PostgreSQL DDL 編譯通過，不能替代實際 PostgreSQL 驗證。

## 驗證證據與限制

- `bash scripts/check.sh api`、`bash scripts/check.sh contract`：通過。
- SQLite `test_finance_router.py -k 'not budget_drafts_can_be_edited_and_deleted_by_their_creator' --no-cov`：29 案通過。原有草案刪除案例先前因 SQLite 外鍵級聯語意失敗，未納入最後這次回歸；仍需 PostgreSQL 完整驗證。
- 財務 Vitest：20 案通過，涵蓋上傳、失敗保留輸入、跨版本收款、歷史收入及 PDF 自動預覽。Web 型別與 production build 通過。
- 全站 Web 檢查曾有 858 案通過、1 案商品尺寸表焦點測試失敗；該檔獨立重跑 7 案通過。未將全站檢查記為全綠。
- Chromium 以原始 Excel 與合成收據驗證上傳、直接收款、桌面／390px 手機及 PDF 畫布白色像素，沒有整頁橫向溢位。未使用正式會話；測試環境缺少公告 WebSocket。

## 影響分析

GitNexus 綁定 `/home/ted98/projects/main`，完整重建後執行 detect-changes。全工作樹含其他來源修改，提交另審 staged 範圍。改動跨 router、service、資料表與公開頁，整體風險 HIGH。

直接流程為 FinancePage → BudgetWorkspace → 總表／登記元件；import_budget → import_budget_from_xlsx → _parse_budget_workbook；budget_detail／收入 router → income_records；公開表格與 EvidencePreview → PdfEvidenceViewer。公開讀取影響總覽、明細與 metadata。

React 入口的 UNKNOWN 已補查 import／JSX 引用與測試。索引的全庫流程生成有容量上限，不代表全庫流程完整；另核對 detect-changes 列出符號與總數，未把 partial／truncated 當通過。
