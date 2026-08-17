# HCCA 效能觀測 Runbook

這份文件描述 production performance observability 的資料來源、判讀方式與維護
規則。RUM 與 synthetic 必須分開解讀：前者回答真實使用者遇到什麼，後者提供可
重現的基準與 regression gate。

## 資料流與責任邊界

| 層級 | 來源 | 主要資料 | 用途 |
|---|---|---|---|
| 真實使用者（RUM） | `WebVitalsReporter`、`PerformanceMonitor`、`client-metrics` | LCP、INP、CLS、FCP、navigation TTFB/total、API/fetch、互動回饋、resource、long task、client error | 依 route、device、auth、release 找出使用者實際慢點 |
| 公開 synthetic | Celery PSI/CrUX collector | Lighthouse/PageSpeed score、LCP、INP、CLS、FCP、TTFB、TBT、Speed Index | 可重現的 public mobile/desktop 基準 |
| 登入 synthetic | `.github/workflows/authenticated-performance.yml` | 所有可發現 static page，加上設定與 RUM 發現的 protected route；mobile/desktop Lighthouse | 驗證登入後頁面與版本 regression |
| API / infrastructure | `/api/metrics`、Sentry、query audit | endpoint histogram、HTTP error/timeout/slow request、DB query count/time、Redis/Celery health | 將 frontend 慢點定位到 API、DB、Redis 或第三方 |

## 維度與統計規則

- RUM route 只保留 query/hash 之前的 bounded path；維度為 `device_class`、
  `auth_state`、`release`，connection type 僅作輔助切分。
- 所有主要 latency 與 Web Vitals 使用 p50/p75/p95/p99；CLS 保留原始比例，
  不轉成毫秒。
- RUM 目前保留 Redis bounded buffer（最多 20,000 筆、48 小時），dashboard
  查詢結果短暫 cache；這是第一方診斷資料，不取代 PostHog 的 DAU/session 分析。
- client telemetry 每批最多 50 筆、最多 100 筆 pending；上報延後、使用
  `sendBeacon`/`keepalive`，遇到 429/5xx 會 backoff，不阻塞 initial render。
- API telemetry endpoint 使用批次寫入；Redis batch 使用單次 variadic `LPUSH`，
  避免每個 event 產生一個 Redis write command。
- OpenTelemetry API trace 預設採樣率為 `OTEL_TRACES_SAMPLE_RATE=0.1`，Next.js
  server 以 `OTEL_WEB_TRACES_SAMPLE_RATE=0.05` 採樣；兩端都使用 batch exporter，
  queue 上限 2,048、單批最多 512 spans，export timeout 2 秒。這些設定避免
  trace instrumentation 退回全量並拖慢 request critical path。
- 不在 telemetry payload 放 access token、query string、完整 URL 或個人識別資料。

## Dashboard 判讀順序

1. **總覽**：先看 public 與 authenticated coverage、最近 release、health。
2. **真實使用者**：選 1 小時、24 小時或 7 天，依 route／device／auth／release
   比較 LCP、INP、CLS、FCP、TTFB 與 API percentiles。
3. **頁面效能**：查看同一路由的 public PSI、authenticated Lighthouse 與 CrUX，
   不把 synthetic score 和 RUM 數值混成單一分數。
4. **錯誤與慢查詢**：用 route template、status、DB query time/count、Redis
   exporter health／capacity 與 OTel trace 中的 Redis spans 對照前端 API p95/p99；
   Grafana 的 API、DB、slow request、timeout 與 Redis panels 是 infrastructure
   root-cause 視圖，admin dashboard 的 RUM panel 則維持真實使用者視角。
5. **部署版本**：以 `release`、`commit_sha`、`deployed_at` 對齊 regression 起點。

判讀範例：若 RUM 只有 mobile `/dashboard` 的 LCP p95 惡化，而 PSI 不變，先查
真實網路／第三方 resource；若 RUM API p99 與 API histogram 同時惡化，再查 DB
query time/count 或 Redis health；若只從某個 release 開始，優先做版本 diff。

## 既定 budget 與告警

- Web interaction feedback：p75 ≤ 100 ms，需改善 ≤ 200 ms。
- API simple GET：p95 ≤ 300 ms；CRUD：p95 ≤ 500 ms；heavy operation：p95 ≤ 2 s。
- Lighthouse performance：預設 score ≥ 95，public 與 authenticated 分開判定。
- Prometheus API latency、DB p95、slow request、timeout、error rate 以 route
  template 與 release 建立 regression alert；不要只用全站平均值。

告警處理時先確認 telemetry 自己沒有造成放大：檢查 client-metrics batch 數量、
429/5xx backoff、Redis buffer 上限與 `/api/metrics` 的 request duration。

## Release / deploy gate

每次 production 變更依序執行：

```text
完整測試 → git push → CI / Docker image → smart deploy
→ /api/ready（DB + Redis）→ public smoke → authenticated Lighthouse
→ /api/metrics build_info / route metrics → dashboard release 對照
```

`hcca_build_info` 應優先顯示 `APP_RELEASE`／`BUILD_COMMIT`，缺少時至少回退到
`APP_VERSION`／`BUILD_REF`，不可用 `unknown` 掩蓋 deployment correlation。

## Overhead 驗證

每次大幅調整 telemetry 都要重跑基準與 enabled 兩組測試，記錄 middleware p50/p95、
browser load、long task、額外 telemetry request 數。現有基準結果：middleware
平均增加約 0.010 ms、p95 約 0.013 ms；browser production standalone test 未
觀察到可歸因的 load 或 long-task regression。若 overhead 上升，優先降低 event
數量、延後 flush、縮短 payload 或改善 batch，不直接關掉核心監測。

## 變更後驗證

```bash
TMPDIR=/tmp npm test
TMPDIR=/tmp npm run type-check
npm run lint
uv run --project apps/api pytest apps/api/tests/test_observability.py -q
uv run --project apps/api ruff check apps/api/src libs/shared/src
curl -fsS https://hcca.tw/api/ready
curl -fsS https://hcca.tw/api/metrics
```

若本機 Redis/PostgreSQL 或 Sentry ingest 不可用，需把它標為環境限制，不能把
該次結果當成 production observability 已驗證。
