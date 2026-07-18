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

## P0 — 本次已完成的公開部署門檻

- [x] 財務 API 改為依 `ledger.org_id` 驗證組織範圍；涵蓋帳本、期間、科目、資金帳戶、
  傳票送審／過帳與 Google Sheets 匯出。驗收：跨組織 UUID 一律 403。
- [x] 財務憑證改為帳本範圍私有上傳、傳票授權下載；Caddy 拒絕公開 `/uploads/finance/evidence/*`，
  且服務層拒絕任意外部／跨帳本 evidence URL。
- [x] 財務過帳以 `SELECT ... FOR UPDATE` 保護。
- [x] 部署腳本會拒絕範例密鑰、未設定 Caddy 信任網段的設定，並在 migration 前建立且驗證
  PostgreSQL 邏輯備份。

## 持續維運要求（部署基礎設施）

- [x] Caddy → API 使用已驗證的 `{client_ip}` 重寫 `CF-Connecting-IP`；API 僅信任
  `CF_TRUSTED_PROXIES` 所指定的 Caddy 網段。
- [ ] Webhook 增加容器 egress firewall／allowlist，防 DNS rebinding 在 DNS lookup 與
  TCP connect 之間變更目的地；webhook signing secret 改為加密靜態儲存。
- [x] WebSocket meeting room 僅允許會議出席名冊中的使用者；維持 query-token 拒絕、
  Origin 檢查與管理員限定 room listing。
- [x] 每把 API key 以 Redis 固定視窗限流；Redis 異常時對外 API 明確 fail-closed。
- [x] Refresh token 的 blacklist 驗證在 Redis 故障時 fail-closed；一般短效 access token 維持可用。
- [x] 移除前端 legacy `localStorage` access-token 路徑與 URL credential。
- [x] 移除具 Docker socket 寫入權限的 `autoheal` 容器；健康服務改依 Docker restart policy 與部署 smoke test。

## 驗收命令

```bash
uv run --project apps/api ruff check apps/api/src libs/shared/src apps/api/tests
uv run --project apps/api ruff format --check apps/api/src libs/shared/src apps/api/tests
uv run --project apps/api pytest apps/api/tests -v --asyncio-mode=auto
cd apps/web && npm run lint && npm run type-check
cd apps/web && npx -y node@24 node_modules/next/dist/bin/next build
```
