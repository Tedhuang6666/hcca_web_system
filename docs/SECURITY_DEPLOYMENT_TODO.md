# 上線安全整備待辦

> 建立：2026-07-18。每一項完成後需附 PR、測試或正式環境驗證紀錄；未完成的 P0
> 不得部署至公開環境。

## P0 — 已在本次程式碼修正，待 CI 與正式環境驗證

- [x] 後台 `/admin` 與 `/admin/system` 全面要求已啟用 MFA。
- [x] 陳情分享改為高熵、僅建立時顯示一次的 token；token 僅放在 URL fragment，前端以 POST body
  查詢，且分享查詢不回傳陳情人身分資料。
- [x] Webhook 僅接受 HTTPS 公網目的地，建立、更新及投遞前均阻擋私網／loopback。
- [x] 修正權限矩陣對巢狀 FastAPI router 的掃描，並辨識 API-key 保護端點。
- [x] `/api/metrics` 由各 Caddy 設定拒絕公開轉送；Prometheus 維持 Docker 內網抓取。
- [x] 映像發布改由成功 CI 觸發，部署改使用 immutable commit-SHA tag。
- [x] 補齊 production `SECRET_KEY` 最低 32 bytes 驗證。
- [x] 修正公文效率統計的 Cartesian product 查詢。
- [x] 特約地圖的 `internal_note` 僅回傳給管理端。
- [x] 修正 SQLite 記憶體測試因 `NullPool` 遺失 schema 的問題。

## P0 — 仍需完成才可公開部署

- [x] 財務 API 改為依 `ledger.org_id` 驗證組織範圍；涵蓋帳本、期間、科目、資金帳戶、
  傳票送審／過帳與 Google Sheets 匯出。驗收：跨組織 UUID 一律 403。
- [ ] 財務憑證改為「帳本／傳票授權下載」端點；不可把 `finance/evidence` 加入公開 uploads。
  驗收：未授權 404/403、授權使用者可下載、資料庫不保存任意外部 evidence URL。
- [x] 財務過帳以 `SELECT ... FOR UPDATE` 保護；仍需在 PostgreSQL CI 補併發過帳測試。
- [ ] production `.env.production` 以 secret manager／部署機密提供，執行
  `docker compose --env-file .env.production ... config`，核對網域、CORS、cookie、
  Cloudflare、SECRET_KEY 與 Redis 密碼；不得提交該檔。
- [ ] migration 前建立可還原備份並演練 restore；本次新增 `share_token_hash` migration
  會使舊式五位數分享連結失效，需先公告或提供重發分享連結流程。

## P1 — 上線後一個衝刺內完成

- [ ] Caddy → API 明確傳遞、API 僅信任 Caddy 網段的真實 client IP；以 Cloudflare
  請求整合測試確認 rate limit、WAF 與 audit IP 不共用也不可偽造。
- [ ] Webhook 增加容器 egress firewall／allowlist，防 DNS rebinding 在 DNS lookup 與
  TCP connect 之間變更目的地；webhook signing secret 改為加密靜態儲存。
- [ ] WebSocket meeting room 改為會議參與者／組織權限授權；目前已阻擋 query token、
  加上 Origin 檢查與限制 room listing，但 meeting room 仍是所有登入者可加入。
- [ ] 實作每把 API key 的 Redis rate limit，並驗證 Redis 故障時的明確 fail-closed 策略。
- [ ] Refresh-token blacklist 在 Redis 故障時改為 fail-closed，或採可驗證的短效撤銷機制。
- [ ] 移除前端 legacy `localStorage` access-token 路徑與所有不必要的 URL credential。
- [ ] 將 `autoheal` 的 Docker socket 改為 socket proxy 或移除；釘選 PostgreSQL、Redis、
  Caddy、PgBouncer、autoheal、k6 的 image digest。

## 驗收命令

```bash
uv run --project apps/api ruff check apps/api/src libs/shared/src apps/api/tests
uv run --project apps/api ruff format --check apps/api/src libs/shared/src apps/api/tests
uv run --project apps/api pytest apps/api/tests -v --asyncio-mode=auto
cd apps/web && npm run lint && npm run type-check
cd apps/web && npx -y node@24 node_modules/next/dist/bin/next build
```
