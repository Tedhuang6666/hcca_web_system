# 智慧部署流程

`scripts/deploy-smart.sh` 是本機 WSL 的正式部署入口，會把本機指定 commit 推到
GitHub，再透過 SSH 讓 Hostinger 以同一個 immutable SHA 從 GHCR 拉取並執行 blue-green
部署。

## 第一次設定

```bash
cp .env.local.example .env.local
chmod 600 .env.local
```

填入 `DEPLOY_HOST`、`DEPLOY_SSH_USER`、`DEPLOY_KEY_PATH` 與 `DEPLOY_DIR`。SSH key 只放在本機，
公鑰放在遠端 `authorized_keys`，不會寫入 repository。

部署前會透過 GitHub CLI 檢查該 commit 的 CI，因此也要先登入一個能讀取此 repository Actions 的
GitHub 帳號：

```bash
gh auth login
```

## 執行

```bash
# 先只檢查決策，不會 push 或連線
scripts/deploy-smart.sh --dry-run

# 推送目前 HEAD，等待 GHCR 映像，遠端健康後切流量
scripts/deploy-smart.sh

# 指定已存在於遠端的版本，不重新 push
scripts/deploy-smart.sh --no-push --release <40-char-sha>
```

預設策略：

- 工作樹或遠端工作樹不是乾淨狀態就中止，不自動丟棄手動變更。
- 只部署完整 commit SHA，不使用 `latest`。
- Docker 映像會在推送 main 後立即平行建置；部署腳本會等待同一 commit 的
  `CI — Lint, Types & Test` workflow 全部成功才連線正式環境。若 CI 失敗，會列出失敗 job 與步驟、
  附上 Actions 連結並中止部署。
- 有新的 Alembic migration 時進入維護模式、先備份 DB 再升級；沒有 migration 時使用
  `MAINTENANCE_MODE=0` 與 `SKIP_MIGRATE=1` 不中斷切流。
- 新版 API/Web/worker 通過 health check 與 smoke test 後才 reload Caddy。
- 無 schema migration 的部署若新版啟動或 smoke 失敗，會嘗試自動切回舊 slot；含 migration
  的部署不自動回滾資料庫，只維持安全失敗狀態。
- 切流成功後預設停止舊 slot（`DEPLOY_KEEP_OLD=false`），避免兩套服務長時間佔用資源。

可在 `.env.local` 覆寫 `DEPLOY_WITH_WORKERS`、`DEPLOY_KEEP_OLD`、
`DEPLOY_HEALTH_WAIT_SECONDS`、`DEPLOY_IMAGE_WAIT_SECONDS`、`DEPLOY_MIGRATION_MODE`
與 `DEPLOY_REQUIRE_GPG_VERIFY`。CI 等待行為可用 `DEPLOY_CI_WORKFLOW`、
`DEPLOY_CI_WAIT_SECONDS` 與 `DEPLOY_CI_POLL_SECONDS` 設定。需要保留舊 slot 時使用 `DEPLOY_KEEP_OLD=true`，不要以手動
`docker compose down` 取代 rollback。
