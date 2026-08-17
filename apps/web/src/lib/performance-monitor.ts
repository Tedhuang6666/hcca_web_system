"use client";

import {
  recordClientMetric,
  recordComponentMetric,
  observeInteractions,
  flushClientMetrics,
  type ComponentMetricPayload,
} from "./client-metrics";

export type VitalName = "fcp" | "lcp" | "cls" | "inp";

export interface ComponentMetric {
  componentName: string;
  renderCount: number;
  totalRenderTime: number;
  avgRenderTime: number;
  maxRenderTime: number;
  lastRenderTime: number;
  actualDuration?: number;
  baseDuration?: number;
  startTime?: number;
  commitTime?: number;
  phase?: "mount" | "update" | "nested-update" | "unmount";
  tags?: Record<string, string>;
}

export interface ComponentVitalMetric {
  componentName: string;
  name: VitalName;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  updatedAt: number;
}

export interface ResourceMetric {
  name: string;
  initiatorType: string;
  duration: number;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
  startTime: number;
  responseEnd: number;
  redirectTime?: number;
  dnsTime?: number;
  connectTime?: number;
  requestTime?: number;
  responseTime?: number;
}

export interface NavigationTimingMetric {
  type: "navigation";
  dns: number;
  tcp: number;
  tls: number;
  ttfb: number;
  download: number;
  domInteractive: number;
  domComplete: number;
  loadEvent: number;
  total: number;
}

export interface LongTaskMetric {
  type: "longtask";
  duration: number;
  startTime: number;
  attribution?: PerformanceEntry[];
}

export interface CustomMetric {
  componentName: string;
  metricName: string;
  value: number;
  unit: "ms" | "bytes" | "count";
  tags?: Record<string, string>;
}

export interface PerformanceEntryMap {
  component: ComponentMetric[];
  componentVitals: ComponentVitalMetric[];
  resource: ResourceMetric[];
  navigation: NavigationTimingMetric | null;
  longtask: LongTaskMetric[];
  vitals: Record<string, number>;
}

type LayoutShiftEntry = PerformanceEntry & {
  hadRecentInput?: boolean;
  value?: number;
  sources?: Array<{ node?: Node | null }>;
};

type LcpEntry = PerformanceEntry & { element?: Element | null };

type EventTimingEntry = PerformanceEntry & { target?: EventTarget | null };

const VITAL_THRESHOLDS: Record<VitalName, [number, number]> = {
  fcp: [1800, 3000],
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  inp: [200, 500],
};

function ratingFor(name: VitalName, value: number): ComponentVitalMetric["rating"] {
  const [good, needsImprovement] = VITAL_THRESHOLDS[name];
  if (value <= good) return "good";
  if (value <= needsImprovement) return "needs-improvement";
  return "poor";
}

function componentNameForNode(node: Node | null | undefined): string | undefined {
  if (!(node instanceof Element)) return undefined;
  const marker = node.closest<HTMLElement>("[data-perf-component]");
  return marker?.dataset.perfComponent || undefined;
}

function safeResourceName(name: string): string {
  try {
    const url = new URL(name, window.location.origin);
    return `${url.origin === window.location.origin ? "" : url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return name.split("?")[0].split("#")[0].slice(0, 500);
  }
}

function isTelemetryResource(name: string): boolean {
  try {
    const path = new URL(name, window.location.origin).pathname;
    return [
      "/analytics/client-metrics",
      "/analytics/client-metrics/batch",
      "/analytics/component-metrics",
      "/analytics/component-metrics/batch",
    ].some((endpoint) => path.endsWith(endpoint));
  } catch {
    return false;
  }
}

function cloneComponentMetric(metric: ComponentMetric): ComponentMetric {
  return { ...metric, tags: metric.tags ? { ...metric.tags } : undefined };
}

class PerformanceMonitor {
  private static instance: PerformanceMonitor;

  private componentMetrics = new Map<string, ComponentMetric>();
  private componentVitals = new Map<string, ComponentVitalMetric>();
  private customMetrics = new Map<string, CustomMetric>();
  private resourceMetrics: ResourceMetric[] = [];
  private pendingResources: ResourceMetric[] = [];
  private navigationMetric: NavigationTimingMetric | null = null;
  private longTaskMetrics: LongTaskMetric[] = [];
  private pendingLongTasks: LongTaskMetric[] = [];
  private vitalMetrics = new Map<VitalName, number>();
  private observers: PerformanceObserver[] = [];
  private interactionCleanup: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private enabled = true;
  private sampleRate = process.env.NODE_ENV === "development" ? 1 : 0.1;
  private snapshotVersion = 0;
  private notifyScheduled = false;
  private sentComponentMetrics = new Map<string, ComponentMetric>();
  private sentCustomMetrics = new Map<string, number>();
  private sentVitals = new Map<string, number>();
  private unloadFlushStarted = false;

  private constructor() {
    if (typeof window !== "undefined") this.init();
  }

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) PerformanceMonitor.instance = new PerformanceMonitor();
    return PerformanceMonitor.instance;
  }

  private init(): void {
    this.setupResourceObserver();
    this.setupNavigationObserver();
    this.setupLongTaskObserver();
    this.setupLargestContentfulPaintObserver();
    this.setupLayoutShiftObserver();
    this.setupINPObserver();
    this.interactionCleanup = observeInteractions();
    this.startPeriodicFlush();
    this.setupVisibilityFlush();
  }

  private isSupported(type: string): boolean {
    return typeof PerformanceObserver !== "undefined" &&
      (PerformanceObserver.supportedEntryTypes ?? []).includes(type);
  }

  private setupResourceObserver(): void {
    if (!this.isSupported("resource")) return;
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        const resource = entry as PerformanceResourceTiming;
        if (isTelemetryResource(resource.name)) return;
        this.recordResource({
          name: safeResourceName(resource.name),
          initiatorType: resource.initiatorType,
          duration: resource.duration,
          transferSize: resource.transferSize,
          encodedBodySize: resource.encodedBodySize,
          decodedBodySize: resource.decodedBodySize,
          startTime: resource.startTime,
          responseEnd: resource.responseEnd,
          redirectTime: Math.max(0, resource.redirectEnd - resource.redirectStart),
          dnsTime: Math.max(0, resource.domainLookupEnd - resource.domainLookupStart),
          connectTime: Math.max(0, resource.connectEnd - resource.connectStart),
          requestTime: Math.max(0, resource.responseStart - resource.requestStart),
          responseTime: Math.max(0, resource.responseEnd - resource.responseStart),
        });
      });
    });
    observer.observe({ type: "resource", buffered: true });
    this.observers.push(observer);
  }

  private setupNavigationObserver(): void {
    if (!this.isSupported("navigation")) return;
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => this.recordNavigation(entry as PerformanceNavigationTiming));
    });
    observer.observe({ type: "navigation", buffered: true });
    this.observers.push(observer);
  }

  private recordNavigation(entry: PerformanceNavigationTiming): void {
    this.navigationMetric = {
      type: "navigation",
      dns: Math.max(0, entry.domainLookupEnd - entry.domainLookupStart),
      tcp: Math.max(0, entry.connectEnd - entry.connectStart),
      tls: entry.secureConnectionStart > 0
        ? Math.max(0, entry.connectEnd - entry.secureConnectionStart)
        : 0,
      ttfb: Math.max(0, entry.responseStart - entry.requestStart),
      download: Math.max(0, entry.responseEnd - entry.responseStart),
      domInteractive: entry.domInteractive,
      domComplete: entry.domComplete,
      loadEvent: Math.max(0, entry.loadEventEnd - entry.loadEventStart),
      total: Math.max(0, entry.loadEventEnd - entry.fetchStart),
    };
    this.notify();
  }

  private setupLongTaskObserver(): void {
    if (!this.isSupported("longtask")) return;
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        const task = entry as PerformanceEntry & { attribution?: PerformanceEntry[] };
        this.recordLongTask({
          type: "longtask",
          duration: task.duration,
          startTime: task.startTime,
          attribution: task.attribution,
        });
      });
    });
    observer.observe({ type: "longtask", buffered: true });
    this.observers.push(observer);
  }

  private setupLargestContentfulPaintObserver(): void {
    if (!this.isSupported("largest-contentful-paint")) return;
    const observer = new PerformanceObserver((list) => {
      const entry = list.getEntries().at(-1) as LcpEntry | undefined;
      if (!entry) return;
      const componentName = componentNameForNode(entry.element);
      if (componentName) this.recordComponentVital("lcp", entry.startTime, componentName);
    });
    observer.observe({ type: "largest-contentful-paint", buffered: true });
    this.observers.push(observer);
  }

  private setupLayoutShiftObserver(): void {
    if (!this.isSupported("layout-shift")) return;
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        const shift = entry as LayoutShiftEntry;
        if (shift.hadRecentInput) return;
        const value = shift.value ?? 0;

        const components = [...new Set(
          (shift.sources ?? []).map((source) => componentNameForNode(source.node)).filter(Boolean),
        )] as string[];
        if (components.length === 0) return;
        components.forEach((componentName) => {
          this.recordComponentVital("cls", value / components.length, componentName);
        });
      });
    });
    observer.observe({ type: "layout-shift", buffered: true });
    this.observers.push(observer);
  }

  private setupINPObserver(): void {
    if (!this.isSupported("event")) return;
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (entry.duration < 40) return;
        const event = entry as EventTimingEntry;
        const componentName = componentNameForNode(event.target as Node);
        if (componentName) this.recordComponentVital("inp", entry.duration, componentName);
      });
    });
    observer.observe({ type: "event", buffered: true });
    this.observers.push(observer);
  }

  recordComponent(metric: ComponentMetric): void {
    if (!this.enabled || Math.random() > this.sampleRate) return;
    const existing = this.componentMetrics.get(metric.componentName);
    if (existing) {
      existing.renderCount += 1;
      existing.totalRenderTime += metric.lastRenderTime;
      existing.avgRenderTime = existing.totalRenderTime / existing.renderCount;
      existing.maxRenderTime = Math.max(existing.maxRenderTime, metric.lastRenderTime);
      existing.lastRenderTime = metric.lastRenderTime;
      existing.actualDuration = metric.actualDuration;
      existing.baseDuration = metric.baseDuration;
      existing.startTime = metric.startTime;
      existing.commitTime = metric.commitTime;
      existing.phase = metric.phase;
      existing.tags = metric.tags ?? existing.tags;
    } else {
      this.componentMetrics.set(metric.componentName, cloneComponentMetric(metric));
    }
    this.notify();
  }

  recordComponentVital(name: VitalName, value: number, componentName: string): void {
    if (!this.enabled || !Number.isFinite(value) || Math.random() > this.sampleRate) return;
    const key = `${componentName}:${name}`;
    const previous = this.componentVitals.get(key);
    const nextValue = name === "cls" ? (previous?.value ?? 0) + value : value;
    if (previous && nextValue < previous.value && name !== "fcp") return;
    this.componentVitals.set(key, {
      componentName,
      name,
      value: nextValue,
      rating: ratingFor(name, nextValue),
      updatedAt: Date.now(),
    });
    this.notify();
  }

  recordResource(metric: ResourceMetric): void {
    if (!this.enabled || Math.random() > this.sampleRate) return;
    this.resourceMetrics.push(metric);
    this.pendingResources.push(metric);
    if (this.resourceMetrics.length > 250) this.resourceMetrics.shift();
    if (this.pendingResources.length > 100) this.pendingResources.shift();
    this.notify();
  }

  recordLongTask(metric: LongTaskMetric): void {
    if (!this.enabled || Math.random() > this.sampleRate) return;
    this.longTaskMetrics.push(metric);
    this.pendingLongTasks.push(metric);
    if (this.longTaskMetrics.length > 80) this.longTaskMetrics.shift();
    if (this.pendingLongTasks.length > 50) this.pendingLongTasks.shift();
    this.notify();
  }

  recordVital(name: VitalName, value: number, componentName?: string): void {
    if (!this.enabled || !Number.isFinite(value)) return;
    const previous = this.vitalMetrics.get(name);
    if (previous !== undefined && value < previous && name !== "fcp") return;
    this.vitalMetrics.set(name, value);
    if (componentName) this.recordComponentVital(name, value, componentName);
    this.notify();
  }

  recordCustomMetric(metric: CustomMetric): void {
    if (!this.enabled || !Number.isFinite(metric.value) || Math.random() > this.sampleRate) return;
    this.customMetrics.set(`${metric.componentName}:${metric.metricName}`, { ...metric });
    this.notify();
  }

  getComponentMetrics(): ComponentMetric[] {
    return [...this.componentMetrics.values()].map(cloneComponentMetric);
  }

  getComponentVitalMetrics(): ComponentVitalMetric[] {
    return [...this.componentVitals.values()];
  }

  getResourceMetrics(): ResourceMetric[] {
    return [...this.resourceMetrics];
  }

  getNavigationMetric(): NavigationTimingMetric | null {
    return this.navigationMetric ? { ...this.navigationMetric } : null;
  }

  getLongTaskMetrics(): LongTaskMetric[] {
    return [...this.longTaskMetrics];
  }

  getVitalMetrics(): Record<string, number> {
    return Object.fromEntries(this.vitalMetrics.entries());
  }

  getAllMetrics(): PerformanceEntryMap {
    return {
      component: this.getComponentMetrics(),
      componentVitals: this.getComponentVitalMetrics(),
      resource: this.getResourceMetrics(),
      navigation: this.getNavigationMetric(),
      longtask: this.getLongTaskMetrics(),
      vitals: this.getVitalMetrics(),
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshotVersion(): number {
    return this.snapshotVersion;
  }

  setSampleRate(rate: number): void {
    this.sampleRate = Math.max(0, Math.min(1, rate));
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  clear(): void {
    this.componentMetrics.clear();
    this.componentVitals.clear();
    this.customMetrics.clear();
    this.resourceMetrics = [];
    this.pendingResources = [];
    this.navigationMetric = null;
    this.longTaskMetrics = [];
    this.pendingLongTasks = [];
    this.vitalMetrics.clear();
    this.sentComponentMetrics.clear();
    this.sentCustomMetrics.clear();
    this.sentVitals.clear();
    this.notify();
  }

  flush(options: { unload?: boolean } = {}): void {
    if (typeof window === "undefined") return;
    if (options.unload) {
      if (this.unloadFlushStarted) return;
      this.unloadFlushStarted = true;
    }
    const path = window.location.pathname;

    for (const metric of this.componentMetrics.values()) {
      const previous = this.sentComponentMetrics.get(metric.componentName);
      const renderCount = metric.renderCount - (previous?.renderCount ?? 0);
      const totalRenderTime = metric.totalRenderTime - (previous?.totalRenderTime ?? 0);
      if (renderCount <= 0) continue;
      const payload: ComponentMetricPayload = {
        component_name: metric.componentName,
        path,
        render_count: renderCount,
        total_render_time_ms: totalRenderTime,
        avg_render_time_ms: totalRenderTime / renderCount,
        max_render_time_ms: metric.maxRenderTime,
        last_render_time_ms: metric.lastRenderTime,
        actual_duration_ms: metric.actualDuration,
        base_duration_ms: metric.baseDuration,
        phase: metric.phase === "nested-update" ? "update" : metric.phase,
        tags: metric.tags,
      };
      recordComponentMetric(payload);
      this.sentComponentMetrics.set(metric.componentName, cloneComponentMetric(metric));
    }

    for (const metric of this.customMetrics.values()) {
      const key = `${metric.componentName}:${metric.metricName}`;
      if (this.sentCustomMetrics.get(key) === metric.value) continue;
      recordClientMetric({
        metric: `component_${metric.unit}`,
        value: metric.value,
        path,
        component_name: metric.componentName,
      });
      this.sentCustomMetrics.set(key, metric.value);
    }

    for (const resource of this.pendingResources.splice(0)) {
      if (resource.duration < 100) continue;
      recordClientMetric({
        metric: "resource_timing",
        value: resource.duration,
        path,
        resource_name: resource.name,
        initiator_type: resource.initiatorType,
        start_time_ms: resource.startTime,
        response_end_ms: resource.responseEnd,
      });
    }

    for (const task of this.pendingLongTasks.splice(0)) {
      recordClientMetric({ metric: "longtask", value: task.duration, path });
    }

    for (const [name, value] of this.vitalMetrics.entries()) {
      if (this.sentVitals.get(name) === value) continue;
      recordClientMetric({ metric: name, value, path });
      this.sentVitals.set(name, value);
    }

    for (const metric of this.componentVitals.values()) {
      const key = `${metric.componentName}:${metric.name}`;
      if (this.sentVitals.get(key) === metric.value) continue;
      recordClientMetric({
        metric: `component_${metric.name}`,
        value: metric.value,
        path,
        component_name: metric.componentName,
      });
      this.sentVitals.set(key, metric.value);
    }

    flushClientMetrics(Boolean(options.unload));
  }

  disconnect(): void {
    this.observers.forEach((observer) => observer.disconnect());
    this.observers = [];
    this.interactionCleanup?.();
    this.interactionCleanup = null;
    if (this.flushInterval) clearInterval(this.flushInterval);
    this.flushInterval = null;
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  private startPeriodicFlush(): void {
    this.flushInterval = setInterval(() => void this.flush(), 30_000);
  }

  private setupVisibilityFlush(): void {
    this.visibilityHandler = () => {
      if (document.visibilityState === "hidden") this.flush({ unload: true });
      else this.unloadFlushStarted = false;
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private notify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    const emit = () => {
      this.notifyScheduled = false;
      this.snapshotVersion += 1;
      this.listeners.forEach((listener) => listener());
    };
    if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
      window.requestAnimationFrame(emit);
    } else {
      setTimeout(emit, 0);
    }
  }
}

export type ProfilerCallback = (
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number,
) => void;

export function createProfilerCallback(componentName: string): ProfilerCallback {
  const monitor = PerformanceMonitor.getInstance();
  return (id, phase, actualDuration, baseDuration, startTime, commitTime) => {
    monitor.recordComponent({
      componentName: id || componentName,
      renderCount: 1,
      totalRenderTime: actualDuration,
      avgRenderTime: actualDuration,
      maxRenderTime: actualDuration,
      lastRenderTime: actualDuration,
      actualDuration,
      baseDuration,
      startTime,
      commitTime,
      phase,
    });
  };
}

export function getPerformanceMonitor(): PerformanceMonitor {
  return PerformanceMonitor.getInstance();
}

export function logPerformanceSummary(): void {
  if (typeof window === "undefined") return;
  const metrics = PerformanceMonitor.getInstance().getAllMetrics();
  console.group("Performance summary");
  console.table(metrics.component.slice().sort((a, b) => b.avgRenderTime - a.avgRenderTime).slice(0, 10));
  console.table(metrics.componentVitals);
  console.table(metrics.resource.slice().sort((a, b) => b.duration - a.duration).slice(0, 10));
  console.groupEnd();
}
