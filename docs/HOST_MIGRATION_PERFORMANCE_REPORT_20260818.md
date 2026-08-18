# HCCA 新舊 VPS 效能與正式站搬遷評估報告

## 1. 結論

建議將正式站搬到 Hostinger `72.62.198.139`，並保留舊 Vultr 作為 24–48 小時 rollback 站。

新機在本次同口徑測試中具備明顯優勢：

- 4 vCPU / 15 GiB RAM，舊機為 2 vCPU / 4 GiB RAM。
- 新機無 swap、CPU steal 約 0%；舊機測到 64–72% CPU steal，顯示明顯虛擬化主機爭用。
- API `/ready` 20 次直連測試：新機平均 0.258 秒、p95 0.276 秒；舊機平均 0.801 秒、p95 1.383 秒。
- 首頁 20 次直連測試：新機平均 0.526 秒、p95 0.496 秒；舊機平均 0.920 秒、p95 1.916 秒。
- 新機磁碟使用率約 5%，舊機約 60%。
- 兩邊 HCCA 資料庫均有 222 張非系統資料表，uploads 均約 75 MB。

目前新機仍使用 `test.hcca.tw`，尚未切換正式 `hcca.tw`。

## 2. 測試範圍與時間

| 項目 | 內容 |
|---|---|
| 舊主機 | Vultr `107.191.53.200`，hostname `hcca40-web` |
| 新主機 | Hostinger `72.62.198.139`，hostname `srv1911543` |
| 收集時間 | 2026-08-18 01:16–01:18 UTC |
| API 測試 | `/api/ready`，20 次，HTTPS 直連 IP，保留 Host/SNI |
| 首頁測試 | `/`，20 次，HTTPS 直連 IP，保留 Host/SNI |
| 主機取樣 | `vmstat` 5 秒取樣、`iostat` 3 組取樣、load average |
| 資料檢查 | PostgreSQL readiness、資料表數、資料庫大小、uploads volume |
| 版本 | Runtime API/Web image 均為 `d75739a84bfcd7fa93f4aa53aab1ea77a5bf522b` |

這是低流量基線與短時間取樣，不是壓力測試；正式切換前仍需做一次最終同步與小流量觀察。

## 3. 主機資源比較

| 指標 | 舊 Vultr | 新 Hostinger | 評估 |
|---|---:|---:|---|
| vCPU | 2 | 4 | 新機 2 倍 |
| RAM | 3.8 GiB | 15 GiB | 新機約 4 倍 |
| Root disk | 75 GiB | 193 GiB | 新機約 2.6 倍 |
| 已使用磁碟 | 43 GiB / 60% | 9 GiB / 5% | 新機空間餘裕大 |
| 可用記憶體 | 約 1.4 GiB | 約 13 GiB | 舊機記憶體壓力較高 |
| Swap | 5.3 GiB，已使用約 117 MiB | 無 swap | 新機延遲較可預測 |
| 取樣 load 1m | 約 0.52–0.73 | 約 0.15–0.22 | 新機較低；需配合 CPU 數解讀 |
| CPU steal | 取樣曾達 64–72% | 約 0% | 舊機有嚴重 noisy-neighbor 風險 |

舊機的 CPU steal 是本報告最重要的風險訊號。它代表 VM 想使用 CPU，但實際時間被 hypervisor/其他租戶拿走；即使 load average 看起來不高，API 延遲仍會出現長尾。

## 4. HCCA runtime 狀態

兩台主機的 HCCA 核心服務均正常：

- PostgreSQL、PgBouncer、Redis、Redis cache/broker/realtime 均 healthy。
- API `/live` 與 `/ready` 均回 HTTP 200。
- `/ready` 回報 database 與 redis 均 `ok: true`。
- Web、Caddy、Celery beat、email worker 均運作中。

### 目前部署差異

| 項目 | 舊 Vultr | 新 Hostinger |
|---|---|---|
| Domain | `hcca.tw` | `test.hcca.tw` |
| API workers | 目前舊配置 | 2 Gunicorn workers |
| Celery general workers | 1 | 2 個 solo worker replicas |
| Email worker | 1 | 1 |
| 額外容器 | `hcca-api-recovery` 額外常駐，約 484 MiB | 無 recovery 容器 |
| API memory cap | 約 1.2 GiB | 1.5 GiB |
| Worker memory cap | 約 1.2 GiB | 每個 768 MiB |

新機的兩個 Celery worker 使用 `solo`、各 concurrency 1，避開過去 prefork 造成 CPU 飆升的問題。

## 5. HTTP 延遲結果

測試包含 TLS、Caddy、API/Web reverse proxy 與應用程式處理時間；來源為同一台測試工作站，使用 `curl --resolve` 直連兩台 VPS，未經公共 DNS 切換。

### API `/api/ready`

| 統計 | 舊 Vultr | 新 Hostinger | 新機改善 |
|---|---:|---:|---:|
| 次數 | 20 | 20 | — |
| 最小值 | 0.384 s | 0.242 s | — |
| 平均 | 0.801 s | 0.258 s | 約快 68% |
| 中位數 | 0.656 s | 0.256 s | 約快 61% |
| p95 | 1.383 s | 0.276 s | 約快 80% |
| 最大值 | 2.716 s | 0.276 s | 長尾明顯降低 |

### 首頁 `/`

| 統計 | 舊 Vultr | 新 Hostinger | 新機改善 |
|---|---:|---:|---:|
| 次數 | 20 | 20 | — |
| 最小值 | 0.290 s | 0.456 s | — |
| 平均 | 0.920 s | 0.526 s | 約快 43% |
| 中位數 | 0.634 s | 0.474 s | 約快 25% |
| p95 | 1.916 s | 0.496 s | 約快 74% |
| 最大值 | 2.984 s | 1.505 s | 長尾降低 |

首頁新機的最小值未必比舊機低，可能受 Next.js SSR、快取狀態與測試瞬間背景任務影響；但平均、p95 與最大值均明顯較佳。

## 6. 資料與儲存比較

| 指標 | 舊 Vultr | 新 Hostinger |
|---|---:|---:|
| 非系統資料表 | 222 | 222 |
| PostgreSQL database size | 約 36 MB | 約 33 MB |
| PostgreSQL volume | 約 91 MB | 約 89 MB |
| uploads volume | 約 75 MB | 約 75 MB |
| uploads 檔案數 | 85 | 85 |
| Redis main memory | 約 17.5 MB | 約 17.3 MB |

資料表與 uploads 數量一致；資料庫物理大小的些微差異屬 PostgreSQL vacuum/頁面配置差異，不能直接視為資料遺失。正式切換前仍要執行一次 final dump checksum 與關鍵資料筆數比對。

## 7. 搬遷建議

### 建議正式切換

新機已達到可承接正式站的硬體與效能門檻，建議採以下方式切換：

1. 先將 `test.hcca.tw` 維持 staging，完成登入、OAuth、上傳、購票、學餐、問卷、Celery 任務與 Email smoke test。
2. 降低 `hcca.tw` DNS TTL 至 300 秒，等待既有 TTL 生效。
3. 短暫進入維護/寫入凍結窗口，執行 PostgreSQL final dump。
4. 將 final dump 與最後一批 uploads delta 同步到新機，驗證 checksum、資料表數與關鍵業務筆數。
5. 將新機 `.env.production` 的所有 staging domain 設定改成正式 `hcca.tw`，包含 CORS、OAuth callback、Passkey RP、Email link、VAPID subject 與 Caddy domain。
6. 確認 `hcca.tw` 與 `www.hcca.tw` DNS/Cloudflare origin 指向新機，取得新機正式 TLS 憑證。
7. 切換後持續觀察 24–48 小時，再決定是否關閉舊機。

### 切換前必確認的風險

- 新機目前是 `test.hcca.tw`，不可直接當成正式 `hcca.tw` 使用；正式切換前要完整替換 domain 設定並重建 API/Web/Proxy。
- 新機的 Celery worker 目前以 `--scale celery-worker=2` 執行。未來部署命令必須保留這個 scale，否則一般 `docker compose up` 可能降回 1 個 worker。
- `www.test.hcca.tw` 尚無 DNS record；staging 主域名可用，但若需要 www staging，需先建立 DNS record。正式 `www.hcca.tw` 則需確認既有 DNS 與憑證流程。
- 舊機存在額外 `hcca-api-recovery` 容器；切換前要確認新機是否需要同等 recovery 機制，不能只比較 api/web 核心容器。
- 舊機曾出現短暫 Caddy 503，但根因與 API/DB readiness timeout 及 CPU steal/延遲有關；切換後應設定 API、Caddy、PostgreSQL、Celery 與主機告警。

## 8. 建議的正式監測門檻

切換後至少觀察以下指標：

| 指標 | 建議告警門檻 |
|---|---|
| API `/ready` | 連續 3 次非 200，或 5 分鐘可用率低於 99.9% |
| API p95 latency | 連續 5 分鐘高於 1 秒 |
| API p99 latency | 連續 5 分鐘高於 2 秒 |
| CPU steal | 超過 5% 持續 5 分鐘；超過 20% 立即調查供應商 |
| RAM available | 低於 2 GiB |
| Swap in/out | 出現持續 swap activity |
| Disk usage | 70% warning、85% critical |
| PostgreSQL connections | 超過 PgBouncer client/server pool 80% |
| Redis memory | 超過配置上限 80% |
| Celery queue depth | 連續 5 分鐘上升或 DLQ 增長 |
| Container restart | 任一核心容器 10 分鐘內重啟 2 次 |

建議正式環境持續送出 node exporter、cAdvisor、PostgreSQL exporter、Redis exporter、Caddy access metrics 與 API histogram；本次報告是基線，不等同於長期監控系統。

## 9. 最終判定

**建議搬遷：是。**

理由是新機不只規格較大，還在本次實測中呈現更低的 API 長尾延遲、更低的 CPU steal、更大的記憶體與磁碟餘裕。主要剩餘工作是 final delta sync、正式 domain 切換、Celery scale 持久化與 24–48 小時 rollback 觀察。
