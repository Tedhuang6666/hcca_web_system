# 維護環境

以 `PROJECT_CONTEXT.md` 找實作、`AI_WORKFLOW.md` 選驗證；不依賴個人 memory、外掛設定或歷史測試報告。
Python 版本見 `.python-version`，Node 版本見 `.nvmrc`，安裝依賴使用既有 lockfiles。

`bash scripts/check.sh doctor` 只檢查工具，不啟動服務，也不能替代測試。
API 測試預設使用 `docker-compose.test.yml` 建立獨立 PostgreSQL `campus_platform_test` 與 Redis，
只對 loopback 開放 55432／56379。執行 `bash scripts/check.sh api-test` 時，缺少任一測試 URL
便會啟動並等待兩項服務健康；亦可用 `bash scripts/check.sh test-services up|check|status|down`
手動管理。`down` 停止容器但保留測試資料卷。自訂 `TEST_DATABASE_URL` 必須是 loopback
PostgreSQL `*_test`，`TEST_REDIS_URL` 必須是 loopback Redis；測試前會快速檢查連線，不會輸出 URL
或憑證。`api-test` 會把應用資料庫、Redis、Celery broker 與 result backend 全部切到測試端點。
CI 若已提供 `TEST_DATABASE_URL` 與 loopback `REDIS_URL`，會沿用 CI 服務及各自設定的 Redis 角色 URL。
SQLite 僅能透過明確 URL 與 `ALLOW_SQLITE_TEST_DB=true` 選用，其結果不能視為 PostgreSQL 或
migration 驗證。

PostgreSQL 測試 schema 從 Alembic 基線建立，之後清空 migration 種子列，讓行為案例自行建立資料。
基線與完整歷史的 schema、trigger、序號及種子資料另以 migration 回歸比較。
新空庫使用 `alembic -x baseline=true upgrade head`；舊庫繼續使用 `alembic upgrade head`。
詳見 `apps/api/alembic/README.md`。

GitNexus CLI 固定使用 `--repo .`，MCP 先依實際路徑辨識索引。
索引錯置時使用 `bash scripts/refresh-code-index.sh` 完整重建，不以 UNKNOWN 或空結果當成低風險。

每次任務先確認工作樹，HCCA 任務直接在 `main` 工作，不建立任務 worktree 或分支。
提交只包含本次檔案；若 index 已有其他來源內容，明確指定提交路徑。
相應驗證通過並完成 commit 後，自動執行 `git push origin main`。
推送到 `develop` 或其他分支、強制推送、部署或變更遠端分支保護仍須當次明確核准。
個人 IDE、模型、外掛及服務狀態留在忽略的本機設定；修改它們不屬於一般程式維護。
