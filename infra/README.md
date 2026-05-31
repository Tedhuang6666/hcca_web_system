# infra/

對應企業級路線圖 Phase A1-A2 部署基礎設施。

| 子目錄 | 內容 | 對應 ADR |
|---|---|---|
| `caddy/` | reverse proxy + LB 設定 | [ADR-002](../docs/adr/002-ha-two-replica.md) |
| `prometheus/` | metrics 抓取設定 | [ADR-001](../docs/adr/001-cloudflare-edge.md) |
| `grafana/` | dashboard 與資料源 provisioning | — |

## 套用方式

```bash
# Production：
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Production blue-green（零停機部署）：
docker compose --env-file .env.production -f docker-compose.bluegreen.yml up -d db redis proxy
bash scripts/zero-downtime-deploy.sh blue

# Dev 維持原樣：
bash dev.sh
```

零停機部署細節請看 [docs/ZERO_DOWNTIME_DEPLOY.md](../docs/ZERO_DOWNTIME_DEPLOY.md)。

## 預設 ports

| Service | Port (host) | 對外（透過 Cloudflare） |
|---|---|---|
| Caddy → api LB | 127.0.0.1:8080 | yes（Cloudflare → origin :8080） |
| Caddy → admin | 127.0.0.1:8081 | yes（admin.<domain>） |
| Caddy → web | 127.0.0.1:8082 | yes |
| Grafana | 127.0.0.1:3001 | no（Cloudflare Tunnel/Access） |
| Prometheus | 127.0.0.1:9090 | no |
| Flower | 127.0.0.1:5555 | no |
| PostgreSQL | （內網） | no |
| PgBouncer | （內網） | no |
| Redis | （內網） | no |

## TODO（Phase A 期間補）

- [ ] Caddy + Origin TLS（Cloudflare Origin Certificate）
- [ ] Prometheus rule files（SLO 違反告警）
- [ ] Grafana dashboards JSON（請求延遲、5xx、Celery queue depth）
- [ ] redis_exporter + postgres_exporter
- [ ] Alertmanager（可選；初期用 Sentry 即可）
- [ ] backup volume mount for cross-host sync
