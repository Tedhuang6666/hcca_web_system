# Phase 1 資料約束的分階段執行

這些步驟必須先在隔離測試資料庫演練，並確認查詢的資料庫目標。正式資料庫的清理與 migration 依專案規範另行取得授權；不得把測試結果當成正式資料狀態。

1. 升級前，在目標資料庫執行 `psql -v ON_ERROR_STOP=1 -f scripts/sql/phase1_check_invariants.sql`。記錄各項違規筆數；依個別業務紀錄查明原因，不能用一套公式自動改寫款項或案件狀態。
2. 確認備份與修復計畫後，套用 revision `20261117040000`。它以 PostgreSQL `NOT VALID` 建立 CHECK，不掃描既有資料，但立即檢查所有新寫入與更新；包含舊違規列的其他欄位更新也可能被擋下。
3. 另行核准並處理違規資料，再重跑第 1 步，確認四項皆為零。清理須依實際資料制訂並保留稽核紀錄，不可推定金額或狀態的正確值。
4. 執行 `psql -v ON_ERROR_STOP=1 -f scripts/sql/phase1_validate_constraints.sql`。四個驗證在同一交易中，任何一項失敗都不會部分完成；再檢查 `pg_constraint.convalidated`。

`NOT VALID` 建立與 `VALIDATE` 是兩次獨立作業，不能把驗證步驟接在一般 `alembic upgrade head` 內自動執行。回滾新增約束可降回 `20261117030000`，不會復原人工清理的資料；資料復原須依備份與授權作業處理。
