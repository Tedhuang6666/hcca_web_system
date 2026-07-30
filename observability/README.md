# HCCA 可觀測性堆疊

## 啟動

~~~bash
OTEL_ENABLED=true docker compose --profile observability up -d
~~~

正式環境使用 production compose：

~~~bash
OTEL_ENABLED=true docker compose --env-file .env.production -f docker-compose.prod.yml --profile monitoring up -d
~~~

服務預設只綁定本機：

- Grafana：http://localhost:3001
- Prometheus：http://localhost:9090
- Alertmanager：http://localhost:9093
- Tempo：http://localhost:3200

將 ALERTMANAGER_DISCORD_WEBHOOK_URL、GRAFANA_ADMIN_PASSWORD 與正式環境的
APP_RELEASE 放入 .env 後再啟動。API、Celery worker 與 Next.js server 會使用
request_id、trace_id、error_id、service、environment、release 欄位串聯
錯誤、日誌、指標與 trace。

## 資料流

- API/Celery/Next.js → OpenTelemetry Collector → Tempo
- Collector metrics → Prometheus
- Docker JSON logs → Promtail → Loki
- Prometheus → Alertmanager → Discord
- API 5xx/Celery failure → PostgreSQL system_incidents / system_incident_events

Recovery Agent 只能接收固定的 action/target 白名單；RECOVERY_AGENT_URL 留空時，
所有需要外部 agent 的重啟、Caddy reload、任務重試都會安全拒絕。自動恢復預設關閉，
且重啟每個目標每小時最多 RECOVERY_MAX_RESTARTS_PER_HOUR 次。
