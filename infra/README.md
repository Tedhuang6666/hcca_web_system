# infra/

正式環境的 reverse proxy、監控與 dashboard provisioning。

| 子目錄 | 內容 | 對應 ADR |
|---|---|---|
| `caddy/` | reverse proxy + LB 設定 | [ADR-002](../docs/adr/002-ha-two-replica.md) |
| `prometheus/` | metrics 抓取設定 | [ADR-001](../docs/adr/001-cloudflare-edge.md) |
| `grafana/` | dashboard 與資料源 provisioning | — |

## 套用方式

```bash
# Production
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Monitoring（Prometheus + Grafana）
docker compose --env-file .env.production -f docker-compose.prod.yml \
  --profile monitoring up -d prometheus grafana

# Production blue-green（零停機部署）
docker compose --env-file .env.production -f docker-compose.bluegreen.yml up -d db redis proxy
bash scripts/zero-downtime-deploy.sh blue

# Development
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

## 待完成

- [ ] Caddy + Origin TLS（Cloudflare Origin Certificate）
- [ ] redis_exporter + postgres_exporter
- [ ] Alertmanager 通知接 Discord / Email
- [ ] backup volume mount for cross-host sync
