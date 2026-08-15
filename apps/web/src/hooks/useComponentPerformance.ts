"use client";

import {
  createElement,
  Profiler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
  type RefObject,
} from "react";
import {
  createProfilerCallback,
  getPerformanceMonitor,
  type ComponentMetric,
} from "@/lib/performance-monitor";

export interface UseComponentPerformanceOptions {
  /** 元件名稱；也會用於 LCP／CLS／INP 的 DOM 歸因標記 */
  name?: string;
  /** 是否以 requestAnimationFrame 估算元件實際更新時間 */
  autoTrack?: boolean;
  /** 自定義標籤用於分組 */
  tags?: Record<string, string>;
}

export interface UseComponentPerformanceReturn {
  /** 把 ref 掛到元件的根 DOM，讓 Web Vitals 能歸因到這個元件 */
  ref: RefObject<HTMLElement | null>;
  /** 可直接 spread 到根 DOM 的效能標記 */
  markerProps: { "data-perf-component": string };
  recordMetric: (metricName: string, value: number, unit?: "ms" | "bytes" | "count") => void;
  recordRender: (duration: number) => void;
  getStats: () => ComponentMetric | undefined;
  reset: () => void;
  startTiming: (label: string) => () => number;
}

export function useComponentPerformance(
  options: UseComponentPerformanceOptions = {},
): UseComponentPerformanceReturn {
  const { name, autoTrack = true, tags = {} } = options;
  const monitor = useMemo(() => getPerformanceMonitor(), []);
  const componentNameRef = useRef(name || "AnonymousComponent");
  const elementRef = useRef<HTMLElement | null>(null);
  const renderCountRef = useRef(0);
  const customMetricsRef = useRef<Set<string>>(new Set());
  componentNameRef.current = name || componentNameRef.current;

  useEffect(() => {
    if (!autoTrack || typeof window === "undefined") return;
    const renderStartedAt = performance.now();
    const frameId = window.requestAnimationFrame(() => {
      const duration = performance.now() - renderStartedAt;
      renderCountRef.current += 1;
      monitor.recordComponent({
        componentName: componentNameRef.current,
        renderCount: 1,
        totalRenderTime: duration,
        avgRenderTime: duration,
        maxRenderTime: duration,
        lastRenderTime: duration,
        phase: renderCountRef.current === 1 ? "mount" : "update",
        tags,
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  });

  const recordRender = useCallback((duration: number) => {
    renderCountRef.current += 1;
    monitor.recordComponent({
      componentName: componentNameRef.current,
      renderCount: 1,
      totalRenderTime: duration,
      avgRenderTime: duration,
      maxRenderTime: duration,
      lastRenderTime: duration,
      phase: renderCountRef.current === 1 ? "mount" : "update",
      tags,
    });
  }, [monitor, tags]);

  const recordMetric = useCallback((metricName: string, value: number, unit: "ms" | "bytes" | "count" = "ms") => {
    const componentName = componentNameRef.current;
    const key = `${componentName}:${metricName}`;
    customMetricsRef.current.add(key);
    if (unit === "ms") {
      recordRender(value);
    } else {
      monitor.recordCustomMetric({ componentName, metricName, value, unit, tags });
    }
  }, [monitor, recordRender, tags]);

  const getStats = useCallback(
    () => monitor.getComponentMetrics().find((metric) => metric.componentName === componentNameRef.current),
    [monitor],
  );

  const reset = useCallback(() => {
    renderCountRef.current = 0;
    customMetricsRef.current.clear();
  }, []);

  const startTiming = useCallback((label: string) => {
    const startedAt = performance.now();
    return () => {
      const duration = performance.now() - startedAt;
      recordMetric(label, duration, "ms");
      return duration;
    };
  }, [recordMetric]);

  return {
    ref: elementRef,
    markerProps: { "data-perf-component": componentNameRef.current },
    recordMetric,
    recordRender,
    getStats,
    reset,
    startTiming,
  };
}

export function withPerformanceTracking<P extends object>(
  Component: ComponentType<P>,
  displayName?: string,
) {
  const wrappedName = displayName || Component.displayName || Component.name || "WrappedComponent";
  function WithPerformanceTracking(props: P) {
    useComponentPerformance({ name: wrappedName, autoTrack: false });
    return createElement(
      Profiler,
      { id: wrappedName, onRender: createProfilerCallback(wrappedName) },
      createElement(Component, props),
    );
  }
  WithPerformanceTracking.displayName = `withPerformanceTracking(${wrappedName})`;
  return WithPerformanceTracking;
}

export function useComponentPerformanceClass(options: UseComponentPerformanceOptions = {}) {
  const { name, tags = {} } = options;
  const monitor = useMemo(() => getPerformanceMonitor(), []);
  const componentNameRef = useRef(name || "ClassComponent");
  const renderCountRef = useRef(0);
  componentNameRef.current = name || componentNameRef.current;

  const recordRender = (duration: number) => {
    renderCountRef.current += 1;
    monitor.recordComponent({
      componentName: componentNameRef.current,
      renderCount: 1,
      totalRenderTime: duration,
      avgRenderTime: duration,
      maxRenderTime: duration,
      lastRenderTime: duration,
      phase: renderCountRef.current === 1 ? "mount" : "update",
      tags,
    });
  };
  const recordMetric = (metricName: string, value: number, unit: "ms" | "bytes" | "count" = "ms") => {
    if (unit === "ms") {
      recordRender(value);
    } else {
      monitor.recordCustomMetric({
        componentName: componentNameRef.current,
        metricName,
        value,
        unit,
        tags,
      });
    }
  };
  const startTiming = (label: string) => {
    const startedAt = performance.now();
    return () => {
      const duration = performance.now() - startedAt;
      recordMetric(label, duration, "ms");
      return duration;
    };
  };

  return {
    recordRender,
    recordMetric,
    startTiming,
    getStats: () => monitor.getComponentMetrics().find((metric) => metric.componentName === componentNameRef.current),
    reset: () => {
      renderCountRef.current = 0;
    },
  };
}
