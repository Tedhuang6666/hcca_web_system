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
  interaction_id?: string;
  interaction_name?: string;
  interaction_kind?: "click" | "submit";
  operation_kind?: "simple_get" | "crud" | "heavy";
  method?: string;
  budget_ms?: number;
};

const METRIC_WINDOW_MS = 60_000;
const MAX_METRIC_REQUESTS_PER_WINDOW = 20;
const API_METRIC_DEDUP_MS = 10_000;
const METRIC_FLUSH_DELAY_MS = 1_000;
const CLIENT_METRIC_BATCH_SIZE = 50;
const COMPONENT_METRIC_BATCH_SIZE = 25;
const MAX_PENDING_CLIENT_METRICS = 100;
const MAX_PENDING_COMPONENT_METRICS = 50;
const INTERACTION_CONTEXT_TTL_MS = 10_000;
const INTERACTION_COMPLETION_FALLBACK_MS = 250;
const CLIENT_METRIC_BATCH_ENDPOINT = "/analytics/client-metrics/batch";
const COMPONENT_METRIC_BATCH_ENDPOINT = "/analytics/component-metrics/batch";
const METRIC_BACKOFF_MS = 60_000;
let metricWindowStartedAt = 0;
let metricRequestsSent = 0;
let metricBackoffUntil = 0;
const recentApiMetrics = new Map<string, number>();
const pendingClientMetrics: ClientMetric[] = [];
const pendingComponentMetrics: ComponentMetricPayload[] = [];
let metricFlushTimer: ReturnType<typeof setTimeout> | null = null;
let interactionSequence = 0;
let apiRequestSequence = 0;
let activeInteraction: {
  id: string;
  name: string;
  kind: "click" | "submit";
  path: string;
  startedAt: number;
  feedbackRecorded: boolean;
  completionRecorded: boolean;
  apiRequestId: string | null;
  completionTimer: number | null;
} | null = null;

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

function postBatch(endpoint: string, metrics: unknown[], preferBeacon: boolean): boolean {
  if (metrics.length === 0 || !canSendMetric()) return false;
  if (Date.now() < metricBackoffUntil) return false;
  const body = JSON.stringify({ items: metrics });
  const url = apiUrl(endpoint);

  if (preferBeacon) {
    try {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon?.(url, blob)) return true;
    } catch {
      // sendBeacon 不可用時改用 keepalive fetch。
    }
  }

  void fetch(url, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body,
  }).then((response) => {
    if (response.status >= 500 || response.status === 429) {
      // Telemetry is optional. Stop adding traffic while the API is already
      // unhealthy, otherwise failed metrics amplify the original incident.
      metricBackoffUntil = Date.now() + METRIC_BACKOFF_MS;
    }
  }).catch(() => {
    metricBackoffUntil = Date.now() + METRIC_BACKOFF_MS;
  });
  return true;
}

function scheduleMetricFlush(): void {
  if (typeof window === "undefined" || metricFlushTimer) return;
  metricFlushTimer = setTimeout(() => flushClientMetrics(), METRIC_FLUSH_DELAY_MS);
}

function send(metric: ClientMetric): void {
  if (typeof window === "undefined" || !Number.isFinite(metric.value)) return;
  pendingClientMetrics.push({
    ...metric,
    path: (metric.path ?? window.location.pathname).split("?")[0].slice(0, 255),
  });
  if (pendingClientMetrics.length > MAX_PENDING_CLIENT_METRICS) pendingClientMetrics.shift();
  scheduleMetricFlush();
}

export function recordApiMetric(
  metric: Omit<ClientMetric, "metric" | "value"> & { duration_ms: number; request_id?: string },
): void {
  if (typeof window === "undefined") return;
  const { request_id: requestId, ...payload } = metric;
  if (!shouldSkipApiMetric(metric)) {
    send({ metric: "api_latency", value: payload.duration_ms, ...payload });
  }
  completeActiveInteraction(metric.status, metric.duration_ms, requestId);
}

export function recordCircuitOpen(path: string): void {
  send({ metric: "api_circuit_open", value: 1, path, circuit_open: true });
}

export function recordClientMetric(metric: ClientMetric): void {
  send(metric);
}

function interactionName(element: HTMLElement): string {
  const explicit = element.dataset.performanceAction?.trim()
    || element.getAttribute("aria-label")?.trim()
    || element.getAttribute("title")?.trim();
  return (explicit || `${element.tagName.toLowerCase()}.interaction`).slice(0, 120);
}

function finishInteractionIfComplete(): void {
  if (activeInteraction?.feedbackRecorded && activeInteraction.completionRecorded) {
    if (activeInteraction.completionTimer) clearTimeout(activeInteraction.completionTimer);
    activeInteraction = null;
  }
}

function recordInteractionFeedback(interaction: NonNullable<typeof activeInteraction>): void {
  if (activeInteraction?.id !== interaction.id || interaction.feedbackRecorded) return;
  interaction.feedbackRecorded = true;
  send({
    metric: "interaction_feedback",
    value: Math.max(0, performance.now() - interaction.startedAt),
    path: interaction.path,
    interaction_id: interaction.id,
    interaction_name: interaction.name,
    interaction_kind: interaction.kind,
    budget_ms: 100,
  });
  finishInteractionIfComplete();
}

function beginInteraction(element: HTMLElement, kind: "click" | "submit"): void {
  if (activeInteraction && performance.now() - activeInteraction.startedAt < 50) return;
  const startedAt = performance.now();
  const interaction = {
    id: `${Date.now().toString(36)}-${(interactionSequence += 1).toString(36)}`,
    name: interactionName(element),
    kind,
    path: window.location.pathname,
    startedAt,
    feedbackRecorded: false,
    completionRecorded: false,
    apiRequestId: null,
    completionTimer: null,
  };
  activeInteraction = { ...interaction };
  const paint = () => recordInteractionFeedback(activeInteraction ?? interaction);
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(paint);
  else window.setTimeout(paint, 16);
  activeInteraction.completionTimer = window.setTimeout(() => {
    const current = activeInteraction;
    if (current?.id === interaction.id && !current.apiRequestId && !current.completionRecorded) {
      completeActiveInteraction(undefined, 0, undefined, true);
    }
  }, INTERACTION_COMPLETION_FALLBACK_MS);
}

export function beginApiRequest(): string {
  const requestId = `${Date.now().toString(36)}-api-${(apiRequestSequence += 1).toString(36)}`;
  const interaction = activeInteraction;
  if (interaction && !interaction.apiRequestId && performance.now() - interaction.startedAt <= INTERACTION_CONTEXT_TTL_MS) {
    interaction.apiRequestId = requestId;
  }
  return requestId;
}

export function completeActiveInteraction(
  status: number | undefined,
  apiDurationMs: number,
  requestId?: string,
  visualFallback = false,
): void {
  const interaction = activeInteraction;
  if (!interaction || performance.now() - interaction.startedAt > INTERACTION_CONTEXT_TTL_MS) {
    activeInteraction = null;
    return;
  }
  if (!visualFallback && (!requestId || interaction.apiRequestId !== requestId)) return;
  if (interaction.completionRecorded) return;
  interaction.completionRecorded = true;
  send({
    metric: "interaction_completion",
    value: Math.max(0, performance.now() - interaction.startedAt),
    path: interaction.path,
    status,
    duration_ms: apiDurationMs,
    interaction_id: interaction.id,
    interaction_name: interaction.name,
    interaction_kind: interaction.kind,
  });
  finishInteractionIfComplete();
}

export function observeInteractions(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const actionForTarget = (target: EventTarget | null, selector: string) => {
    if (!(target instanceof Element)) return null;
    const element = target.closest<HTMLElement>(selector);
    if (!element || element.dataset.performanceIgnore === "true") return null;
    return element;
  };
  const handleClick = (event: MouseEvent) => {
    const element = actionForTarget(
      event.target,
      "[data-performance-action],button,a,[role='button'],input[type='submit']",
    );
    if (element) beginInteraction(element, "click");
  };
  const handleSubmit = (event: SubmitEvent) => {
    const element = actionForTarget(event.target, "form,[data-performance-action]");
    if (element) beginInteraction(element, "submit");
  };

  document.addEventListener("click", handleClick, true);
  document.addEventListener("submit", handleSubmit, true);
  return () => {
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("submit", handleSubmit, true);
  };
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
  if (typeof window === "undefined" || !Number.isFinite(metric.avg_render_time_ms)) return;
  pendingComponentMetrics.push({
    ...metric,
    path: metric.path.split("?")[0].slice(0, 255),
  });
  if (pendingComponentMetrics.length > MAX_PENDING_COMPONENT_METRICS) {
    pendingComponentMetrics.shift();
  }
  scheduleMetricFlush();
}

export function flushClientMetrics(preferBeacon = false): void {
  if (typeof window === "undefined") return;
  if (metricFlushTimer) {
    clearTimeout(metricFlushTimer);
    metricFlushTimer = null;
  }

  const clientMetrics = pendingClientMetrics.splice(
    0,
    preferBeacon ? MAX_PENDING_CLIENT_METRICS : CLIENT_METRIC_BATCH_SIZE,
  );
  const componentMetrics = pendingComponentMetrics.splice(
    0,
    preferBeacon ? MAX_PENDING_COMPONENT_METRICS : COMPONENT_METRIC_BATCH_SIZE,
  );
  const clientSent =
    clientMetrics.length === 0 || postBatch(CLIENT_METRIC_BATCH_ENDPOINT, clientMetrics, preferBeacon);
  const componentSent =
    componentMetrics.length === 0 ||
    postBatch(COMPONENT_METRIC_BATCH_ENDPOINT, componentMetrics, preferBeacon);

  if (!clientSent || !componentSent) {
    pendingClientMetrics.length = 0;
    pendingComponentMetrics.length = 0;
    return;
  }
  if (pendingClientMetrics.length > 0 || pendingComponentMetrics.length > 0) scheduleMetricFlush();
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
