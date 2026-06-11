# 基準量化（Baseline Metrics）

> 在做任何「企業級」改造前先記錄此時數值，後續每階段驗收都以此為對照。

**建立日期**：2026-05-31
**最近量測**：2026-06-11
**對應 commit**：`05ca5aa`

---

## 怎麼用這份文件

1. 在 baseline 欄填入「現在實測」的數值
2. 每完成一個 Phase，回來填「Phase X 實測」欄
3. 達不到目標欄的指標，視為**未通過驗收**

---

## 後端

| 指標 | 怎麼量 | Baseline | Phase A | Phase B | Phase C | Phase D | 目標 |
|---|---|---|---|---|---|---|---|
| 後端冷啟動時間 | `time docker compose up api` 到 `/ready` 200 | 待獨立冷啟動演練 | | | | | < 30 s |
| 後端熱重啟時間 | 已 build 過後 `docker compose restart api` | 待維護窗口演練 | | | | | < 10 s |
| 公開讀取 API p95 | k6，2 VU / 10 秒 / 80 requests | 26.69 ms | | | | | < 500 ms |
| 登入後 documents / regulations p95 | k6 隔離帳號 | 待隔離 Token | | | | | < 500 ms |
| 公文 detail 含 revisions p95 | k6 隔離帳號 | 待隔離公文與 Token | | | | | < 800 ms |
| 公文簽核 round-trip | 從按下到 status 更新 + 通知送出 | 待隔離簽核資料 | | | | | < 1500 ms |
| 5xx 比率（最近 24h） | Sentry 或 access log | 待正式監控累積 24h | | | | | < 0.5% |
| DB 連線高峰使用率 | `pg_stat_activity` count vs max_connections | 待正式尖峰窗口 | | | | | < 70% |
| DB CPU 高峰 | `pg_stat_activity` + iostat | 待正式尖峰窗口 | | | | | < 60% |
| Redis 記憶體使用率 | `INFO memory` | 待正式尖峰窗口 | | | | | < 70% of maxmemory |
| Celery queue 滯後（核心） | Prometheus queue depth / task runtime | 待正式監控累積 | | | | | < 30 s |
| Celery queue 滯後（email） | 同上 | 待正式監控累積 | | | | | < 5 min |
| 後端記憶體使用 | `docker stats campus_api` | 待正式尖峰窗口 | | | | | < 1 GB/container |

## 前端

| 指標 | 怎麼量 | Baseline | Phase A | Phase B | Phase C | Phase D | 目標 |
|---|---|---|---|---|---|---|---|
| 首頁 LCP | Lighthouse CI 行動模式 | 待 CI artifact | | | | | < 2500 ms |
| 首頁 INP | 正式 RUM（實驗室以 TBT 代理） | 待正式流量 | | | | | < 200 ms |
| 首頁 CLS | Lighthouse CI 行動模式 | 待 CI artifact | | | | | < 0.1 |
| Lighthouse Performance | 行動裝置模式 | 待 CI artifact | | | | | > 90 |
| Lighthouse Accessibility | 同上 | 待 CI artifact | | | | | > 90 |
| Lighthouse Best Practices | 同上 | 待 CI artifact | | | | | > 95 |
| Lighthouse SEO | 同上 | 待 CI artifact | | | | | > 90 |
| Initial JS bundle | `next build` + bundle analyzer | 待 production build artifact | | | | | < 500 KB |
| 公文列表頁 TTI | DevTools Performance tab | 待隔離登入流程 | | | | | < 3000 ms |

## 品質

| 指標 | 怎麼量 | Baseline | Phase A | Phase B | Phase C | Phase D | 目標 |
|---|---|---|---|---|---|---|---|
| 後端測試 pass / fail / skip | PostgreSQL `pytest --asyncio-mode=auto` | 409 / 0 / 0 | | | | | 全 pass、skip 有理由 |
| 後端測試覆蓋率 | `pytest --cov` | 53.82% | | | | | > 70% |
| 前端單元測試 pass / fail | `npm test` | 10 / 0 | | | | | 全 pass |
| 前端受測模組覆蓋率 | Vitest V8 statements | 76.38% | | | | | 不得下降 |
| 公開 E2E pass / skip | Playwright desktop + mobile | 4 / 6（登入流程需 storage state） | | | | | 核心流程全 pass |
| Ruff errors | `ruff check apps/api/src libs/shared/src` | 2（既有未提交檔案） | | | | | 0 |
| TypeScript errors | `npm run type-check` | 0 | | | | | 0 |
| TODO/FIXME/XXX 數 | 限 `*.py/*.ts/*.tsx` | 542 | | | | | 每個都有 owner |

## 可用性（從 Phase A 開始可量）

| 指標 | 怎麼量 | Baseline | Phase A | Phase B | Phase C | Phase D | 目標 |
|---|---|---|---|---|---|---|---|
| 月可用性 | UptimeRobot 月報 | N/A | | | | | > 99.5% |
| 平均月停機時間 | UptimeRobot | N/A | | | | | < 3.6 h |
| 部署 frequency | git tag / deploy log | 月 ? 次 | | | | | 週 ≥ 1 次 |
| MTTR（incident 復原） | docs/INCIDENT_RUNBOOK 紀錄 | N/A | | | | | < 4 h |
| 備份還原時間（DR drill） | `scripts/dr-database-drill.sh` | 8 秒（本機 PostgreSQL） | | | | | < 4 h |

---

## 量測指令範本

### 後端 p95（k6）
```bash
# 安裝 k6: choco install k6 (Windows) or brew install k6 (Mac)
# 在 scripts/perf/documents_list.js:
import http from 'k6/http';
export const options = { vus: 10, duration: '30s' };
export default function() {
  http.get('http://localhost:8000/api/v1/documents',
    { headers: { Authorization: 'Bearer YOUR_TOKEN' } });
}
# 跑：
k6 run scripts/perf/documents_list.js
# p(95) 在輸出底部
```

### Lighthouse
```bash
# Chrome DevTools → Lighthouse tab → 行動裝置 + Performance/A11y/BP/SEO
# 截圖存 docs/audits/YYYY-MM-DD-lighthouse-home.png
```

### 測試覆蓋率
```bash
wsl -d Ubuntu -- bash -lc 'cd ~/projects/main && uv run --project apps/api pytest apps/api/tests --cov=apps/api/src --cov-report=term-missing --asyncio-mode=auto'
```

### TODO 計數
```bash
wsl -d Ubuntu -- bash -lc 'cd ~/projects/main && grep -rn "TODO\\|FIXME\\|XXX" --include="*.py" --include="*.ts" --include="*.tsx" apps/ libs/ | wc -l'
```

---

*更新原則：每完成一個 Phase 立即量測並填入。不允許「我覺得進步了」的主觀判斷。*
