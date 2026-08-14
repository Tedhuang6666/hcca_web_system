import { apiUrl } from "./config";

type ClientMetric = {
  metric: string;
  value: number;
  path?: string;
  status?: number;
  duration_ms?: number;
  attempts?: number;
  circuit_open?: boolean;
};

function send(metric: ClientMetric): void {
  if (typeof window === "undefined" || !Number.isFinite(metric.value)) return;
  const body = JSON.stringify({
    ...metric,
    path: (metric.path ?? window.location.pathname).split("?")[0].slice(0, 255),
  });
  const url = apiUrl("/analytics/client-metrics");
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
  send({ metric: "api_latency", value: metric.duration_ms, ...metric });
}

export function recordCircuitOpen(path: string): void {
  send({ metric: "api_circuit_open", value: 1, path, circuit_open: true });
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
    if (entry.name === "first-contentful-paint") send({ metric: "fcp", value: entry.startTime, path: path() });
  });
  observe("largest-contentful-paint", (entry) => send({ metric: "lcp", value: entry.startTime, path: path() }));
  let cumulativeLayoutShift = 0;
  observe("layout-shift", (entry) => {
    const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
    if (!shift.hadRecentInput) {
      cumulativeLayoutShift += shift.value ?? 0;
      send({ metric: "cls", value: cumulativeLayoutShift, path: path() });
    }
  });
  observe("event", (entry) => {
    const duration = entry.duration;
    if (duration >= 40) send({ metric: "inp", value: duration, path: path() });
  });

  return () => observers.forEach((observer) => observer.disconnect());
}
