"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { usePerformanceMonitor } from "@/components/providers/PerformanceProvider";
import type {
  ComponentMetric,
  ComponentVitalMetric,
  ResourceMetric,
} from "@/lib/performance-monitor";

const VITAL_LABELS: Record<string, string> = {
  lcp: "LCP",
  cls: "CLS",
  inp: "INP",
  fcp: "FCP",
};

function formatVital(name: string, value: number): string {
  if (name === "cls") return value.toFixed(3);
  return `${Math.round(value)} ms`;
}

function ratingFor(name: string, value: number): "good" | "needs-improvement" | "poor" {
  if (name === "cls") {
    if (value <= 0.1) return "good";
    if (value <= 0.25) return "needs-improvement";
    return "poor";
  }
  const good = name === "lcp" ? 2500 : name === "inp" ? 200 : 1800;
  const needsImprovement = name === "lcp" ? 4000 : name === "inp" ? 500 : 3000;
  if (value <= good) return "good";
  if (value <= needsImprovement) return "needs-improvement";
  return "poor";
}

function toneFor(rating: "good" | "needs-improvement" | "poor") {
  return {
    good: "bg-[var(--success-dim)] text-[var(--success)]",
    "needs-improvement": "bg-[var(--warning-dim)] text-[var(--warning)]",
    poor: "bg-[var(--danger-dim)] text-[var(--danger)]",
  }[rating];
}

function ComponentRow({ metric }: { metric: ComponentMetric }) {
  const tone = metric.avgRenderTime > 16
    ? "bg-[var(--danger-dim)] text-[var(--danger)]"
    : metric.avgRenderTime > 8
      ? "bg-[var(--warning-dim)] text-[var(--warning)]"
      : "bg-[var(--success-dim)] text-[var(--success)]";
  return (
    <tr className="table-row">
      <td className="max-w-[250px] truncate font-medium">{metric.componentName}</td>
      <td className="text-right tabular-nums">{metric.renderCount}</td>
      <td className="text-right tabular-nums">{metric.avgRenderTime.toFixed(1)} ms</td>
      <td className="text-right">
        <span className={`rounded px-2 py-1 text-xs font-semibold ${tone}`}>
          {metric.maxRenderTime.toFixed(1)} ms max
        </span>
      </td>
    </tr>
  );
}

function VitalCard({ name, value }: { name: string; value: number | undefined }) {
  if (value === undefined) {
    return (
      <div className="border-t border-[var(--border)] pt-3">
        <p className="text-xs font-medium text-[var(--text-muted)]">{VITAL_LABELS[name]}</p>
        <p className="mt-2 text-lg font-semibold text-[var(--text-muted)]">尚未收集</p>
      </div>
    );
  }
  const tone = toneFor(ratingFor(name, value));
  return (
    <div className="border-t border-[var(--border)] pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-[var(--text-muted)]">{VITAL_LABELS[name]}</p>
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${tone}`}>
          {ratingFor(name, value) === "good" ? "良好" : ratingFor(name, value) === "poor" ? "需處理" : "可改善"}
        </span>
      </div>
      <p className="mt-2 text-lg font-semibold tabular-nums">{formatVital(name, value)}</p>
    </div>
  );
}

function ResourceWaterfall({ resources }: { resources: ResourceMetric[] }) {
  const rows = resources.slice(-18);
  if (rows.length === 0) {
    return <p className="px-4 py-8 text-sm text-[var(--text-muted)] sm:px-5">尚未收集到資源計時資料。</p>;
  }
  const start = Math.min(...rows.map((resource) => resource.startTime));
  const end = Math.max(...rows.map((resource) => resource.responseEnd));
  const span = Math.max(end - start, 1);
  return (
    <div
      className="max-w-full overflow-x-auto"
      tabIndex={0}
      role="region"
      aria-label="資源瀑布圖，可水平捲動"
    >
      <div className="min-w-[620px]">
        {rows.map((resource) => {
          const left = ((resource.startTime - start) / span) * 100;
          const width = Math.max((resource.duration / span) * 100, 1.5);
          return (
            <div key={`${resource.name}-${resource.startTime}`} className="grid grid-cols-[minmax(180px,1fr)_72px_minmax(180px,1.6fr)_72px] items-center gap-3 border-t border-[var(--border)] px-5 py-2.5 text-xs">
              <span className="truncate font-medium" title={resource.name}>{resource.name}</span>
              <span className="text-[var(--text-muted)]">{resource.initiatorType}</span>
              <div
                className="relative h-5 overflow-hidden rounded-sm bg-[var(--bg-hover)]"
                aria-label={`${resource.name} 資源瀑布圖`}
              >
                <span
                  className={`absolute top-0.5 h-4 min-w-[3px] rounded-sm ${
                    resource.duration > 500
                      ? "bg-[var(--danger)]"
                      : resource.duration > 200
                        ? "bg-[var(--warning)]"
                        : "bg-[var(--primary)]"
                  }`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              </div>
              <span
                className={`text-right tabular-nums ${
                  resource.duration > 500 ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"
                }`}
              >
                {Math.round(resource.duration)} ms
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ComponentVitalList({ metrics }: { metrics: ComponentVitalMetric[] }) {
  const rows = metrics
    .filter((metric) => metric.name === "lcp" || metric.name === "cls" || metric.name === "inp")
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">將元件根節點掛上 `data-perf-component` 標記後，這裡會顯示歸因結果。</p>;
  }
  return (
    <ul className="divide-y divide-[var(--border)]">
      {rows.map((metric) => {
        const tone = toneFor(metric.rating);
        return (
          <li key={`${metric.componentName}-${metric.name}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span className="min-w-0 truncate font-medium">{metric.componentName}</span>
            <span className={`shrink-0 rounded px-2 py-1 text-xs font-semibold ${tone}`}>
              {VITAL_LABELS[metric.name]} {formatVital(metric.name, metric.value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function PerformanceDashboard() {
  const { monitor } = usePerformanceMonitor();
  const subscribe = useCallback((listener: () => void) => monitor.subscribe(listener), [monitor]);
  useSyncExternalStore(
    subscribe,
    () => monitor.getSnapshotVersion(),
    () => 0,
  );
  const metrics = monitor.getAllMetrics();
  const components = useMemo(
    () => metrics.component.slice().sort((a, b) => b.avgRenderTime - a.avgRenderTime).slice(0, 10),
    [metrics.component],
  );
  const resourceCount = metrics.resource.length;
  const slowResources = metrics.resource.filter((resource) => resource.duration > 200).length;
  const reset = () => monitor.clear();

  return (
    <section className="card overflow-hidden" data-perf-component="PerformanceDashboard" aria-labelledby="performance-dashboard-heading">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[var(--success)]" aria-hidden="true" />
            <h2 id="performance-dashboard-heading" className="text-sm font-semibold">即時元件效能</h2>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            只在目前瀏覽器工作階段更新；每 30 秒批次送往 client metrics。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            className="btn btn-ghost min-h-11 justify-center sm:flex-none"
            type="button"
            onClick={() => void monitor.flush()}
            title="立即上報目前資料"
          >
            <RefreshCw size={14} aria-hidden="true" />
            立即上報
          </button>
          <button
            className="btn btn-ghost min-h-11 justify-center sm:flex-none"
            type="button"
            onClick={reset}
            title="清除目前瀏覽器的效能資料"
          >
            <Trash2 size={14} aria-hidden="true" />
            清除
          </button>
        </div>
      </div>

      <div
        className="grid grid-cols-1 gap-3 px-4 py-4 sm:grid-cols-3 sm:gap-4 sm:px-5 sm:py-5"
        aria-label="Core Web Vitals 摘要"
      >
        {(["lcp", "cls", "inp"] as const).map((name) => (
          <VitalCard key={name} name={name} value={metrics.vitals[name]} />
        ))}
      </div>

      <div
        className="grid grid-cols-2 gap-3 border-t border-[var(--border)] px-4 py-4 sm:grid-cols-4 sm:gap-4 sm:px-5"
        aria-label="效能收集摘要"
      >
        {[
          ["已追蹤元件", metrics.component.length],
          ["長任務", metrics.longtask.length],
          ["資源項目", resourceCount],
          ["慢速資源", slowResources],
        ].map(([label, value]) => (
          <div key={label as string}>
            <p className="text-xs text-[var(--text-muted)]">{label}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid min-w-0 gap-5 border-t border-[var(--border)] px-4 py-5 sm:px-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section aria-labelledby="component-render-heading">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <h3 id="component-render-heading" className="text-sm font-semibold">元件渲染時間</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">React Profiler 與 hook 的工作階段聚合</p>
            </div>
            <span className="shrink-0 text-xs text-[var(--text-muted)]">前 10 名</span>
          </div>
          {components.length === 0 ? (
            <p className="py-8 text-sm text-[var(--text-muted)]">尚未收集到元件渲染資料。</p>
          ) : (
            <div
              className="max-w-full overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="元件渲染時間，可水平捲動"
            >
              <table className="min-w-[520px]">
                <thead className="table-header"><tr><th>元件</th><th className="text-right">次數</th><th className="text-right">平均</th><th className="text-right">峰值</th></tr></thead>
                <tbody>{components.map((metric) => <ComponentRow key={metric.componentName} metric={metric} />)}</tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="component-vitals-heading">
          <div className="mb-3">
            <h3 id="component-vitals-heading" className="text-sm font-semibold">元件級 Web Vitals</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">依 DOM 標記歸因 LCP、CLS、INP</p>
          </div>
          <ComponentVitalList metrics={metrics.componentVitals} />
        </section>
      </div>

      <div className="border-t border-[var(--border)]">
        <div className="px-4 py-4 sm:px-5">
          <h3 className="text-sm font-semibold">資源瀑布圖</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">最近 18 筆資源；紅色代表超過 500 ms。</p>
        </div>
        <ResourceWaterfall resources={metrics.resource} />
      </div>

      {metrics.navigation && (
        <p className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--text-muted)] sm:px-5">
          導航 TTFB {Math.round(metrics.navigation.ttfb)} ms · DOM 完成 {Math.round(metrics.navigation.domComplete)} ms · 總計 {Math.round(metrics.navigation.total)} ms
        </p>
      )}
    </section>
  );
}
