import { apiUrl } from "./config";

type ClientMetric = {
  metric: string;
  value: number;
  path?: string;
  status?: number;
  duration_ms?: number;
  attempts?: number;
  circuit_open?: boolean;
  component_name?: string;
  resource_name?: string;
  initiator_type?: string;
  start_time_ms?: number;
  response_end_ms?: number;
};

const METRIC_WINDOW_MS = 60_000;
const MAX_METRIC_REQUESTS_PER_WINDOW = 20;
const API_METRIC_DEDUP_MS = 10_000;
let metricWindowStartedAt = 0;
let metricRequestsSent = 0;
const recentApiMetrics = new Map<string, number>();

function canSendMetric(): boolean {
  const now = Date.now();
  if (now - metricWindowStartedAt >= METRIC_WINDOW_MS) {
    metricWindowStartedAt = now;
    metricRequestsSent = 0;
  }
  if (metricRequestsSent >= MAX_METRIC_REQUESTS_PER_WINDOW) return false;
  metricRequestsSent += 1;
  return true;
}

function shouldSkipApiMetric(metric: Omit<ClientMetric, "metric" | "value">): boolean {
  const path = (metric.path ?? window.location.pathname).split("?")[0].slice(0, 255);
  const key = `${path}:${metric.status ?? "network"}`;
  const now = Date.now();
  const previous = recentApiMetrics.get(key);
  if (previous && now - previous < API_METRIC_DEDUP_MS) return true;
  recentApiMetrics.set(key, now);
  if (recentApiMetrics.size > 128) {
    const oldestKey = recentApiMetrics.keys().next().value;
    if (oldestKey) recentApiMetrics.delete(oldestKey);
  }
  return false;
}

function send(endpoint: string, metric: ClientMetric): void {
  if (typeof window === "undefined" || !Number.isFinite(metric.value)) return;
  if (!canSendMetric()) return;
  const body = JSON.stringify({
    ...metric,
    path: (metric.path ?? window.location.pathname).split("?")[0].slice(0, 255),
  });
  const url = apiUrl(endpoint);
  try {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.(url, blob)) return;
  } catch {
    // sendBeacon 不可用時改用 keepalive fetch。
  }
  void fetch(url, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body,
  }).catch(() => undefined);
}

export function recordApiMetric(metric: Omit<ClientMetric, "metric" | "value"> & { duration_ms: number }): void {
  if (typeof window === "undefined" || shouldSkipApiMetric(metric)) return;
  send("/analytics/client-metrics", { metric: "api_latency", value: metric.duration_ms, ...metric });
}

export function recordCircuitOpen(path: string): void {
  send("/analytics/client-metrics", { metric: "api_circuit_open", value: 1, path, circuit_open: true });
}

export function recordClientMetric(metric: ClientMetric): void {
  send("/analytics/client-metrics", metric);
}

export interface ComponentMetricPayload {
  component_name: string;
  path: string;
  render_count: number;
  total_render_time_ms: number;
  avg_render_time_ms: number;
  max_render_time_ms: number;
  last_render_time_ms: number;
  actual_duration_ms?: number;
  base_duration_ms?: number;
  phase?: "mount" | "update" | "nested-update" | "unmount";
  tags?: Record<string, string>;
}

export function recordComponentMetric(metric: ComponentMetricPayload): void {
  send("/analytics/component-metrics", {
    metric: "component_render",
    value: metric.avg_render_time_ms,
    ...metric,
  });
}

export function observeWebVitals(): () => void {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return () => undefined;
  const observers: PerformanceObserver[] = [];
  const path = () => window.location.pathname;
  const supported = new Set(PerformanceObserver.supportedEntryTypes ?? []);
  const observe = (type: string, callback: (entry: PerformanceEntry) => void) => {
    if (!supported.has(type)) return;
    const observer = new PerformanceObserver((list) => list.getEntries().forEach(callback));
    observer.observe({ type, buffered: true });
    observers.push(observer);
  };

  observe("paint", (entry) => {
    if (entry.name === "first-contentful-paint") {
      recordClientMetric({ metric: "fcp", value: entry.startTime, path: path() });
    }
  });
  observe("largest-contentful-paint", (entry) => {
    recordClientMetric({ metric: "lcp", value: entry.startTime, path: path() });
  });
  let cumulativeLayoutShift = 0;
  observe("layout-shift", (entry) => {
    const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
    if (!shift.hadRecentInput) {
      cumulativeLayoutShift += shift.value ?? 0;
      recordClientMetric({ metric: "cls", value: cumulativeLayoutShift, path: path() });
    }
  });
  observe("event", (entry) => {
    const duration = entry.duration;
    if (duration >= 40) recordClientMetric({ metric: "inp", value: duration, path: path() });
  });

  return () => observers.forEach((observer) => observer.disconnect());
}
