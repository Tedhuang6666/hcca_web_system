-- 僅在不變量查詢全部為零、違規資料已核准處理後由操作人員明確執行。
-- psql 使用 ON_ERROR_STOP；交易確保任一驗證失敗時不留下部分驗證結果。
BEGIN;
ALTER TABLE receivables VALIDATE CONSTRAINT ck_receivables_amounts;
ALTER TABLE council_proposals VALIDATE CONSTRAINT ck_council_proposals_status;
ALTER TABLE judicial_petitions VALIDATE CONSTRAINT ck_judicial_petitions_status;
ALTER TABLE workflow_instances VALIDATE CONSTRAINT ck_workflow_instances_source_status;
COMMIT;
