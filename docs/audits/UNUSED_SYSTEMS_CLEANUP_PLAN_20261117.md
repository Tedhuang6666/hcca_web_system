# 未使用系統資料退役方案（已核准建立與本機驗證）

基準：`bd0a01ed`；分支：`refactor/unused-systems-cleanup`。

新增 migration `20261117030000`，不修改封存歷史或既有靜態基線。
會移除下列 24 張表及 `governance_cases.program_id`；該欄位的現有案件列保留。
表內歷史資料無法從 schema 還原，downgrade 將明確拒絕，正式套用前須另行核准與備份。

1. `planning_document_revision_attachments`
2. `planning_document_revisions`
3. `planning_document_attachments`
4. `planning_documents`
5. `finance_bank_transactions`
6. `inventory_transactions`
7. `inventory_procurement_items`
8. `activity_members`
9. `programs`
10. `matter_role_assignments`
11. `inventory_items`
12. `discord_activity_workspaces`
13. `activity_roles`
14. `activity_links`
15. `support_ticket_events`
16. `support_impersonation_sessions`
17. `support_audit_logs`
18. `support_assistance_sessions`
19. `support_approvals`
20. `inventory_procurements`
21. `inventory_categories`
22. `support_tickets`
23. `support_guide_entries`
24. `governance_workflow_templates`

本次授權僅限建立 migration 程式，並在本機可丟棄 PostgreSQL 測試庫驗證。
不部署、不連正式資料庫、不執行正式 migration。現行活動授權、工作流、治理事件、
自動化規則、應收款與一般稽核資料保留。未知外鍵相依會阻止刪除，不使用 CASCADE。

使用者於 2026-11-17 明確核准建立 migration 與本機可丟棄測試庫驗證；未核准正式執行。
