# infra/

正式環境的 reverse proxy。監控設定與 dashboard 採用共用的
[observability 設定](../observability/README.md)，由各環境 Compose 掛載。

| 子目錄 | 內容 |
|---|---|
| `caddy/` | reverse proxy + LB 設定 |
| `../observability/prometheus/` | Prometheus 環境設定與 alert rules |
| `../observability/grafana/` | Grafana dashboard 與 datasource provisioning |

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

正式部署入口請看版本庫中的 [production Compose 設定](../docker-compose.prod.yml) 與
[智慧部署腳本](../scripts/deploy-smart.sh)。

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
