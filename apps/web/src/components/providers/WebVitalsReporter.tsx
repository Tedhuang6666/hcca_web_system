"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { useEffect, useRef } from "react";
import { flushClientMetrics, recordClientMetric } from "@/lib/client-metrics";

function report(metric: {
  id: string;
  name: string;
  value: number;
  delta: number;
  rating?: string;
  navigationType?: string;
}) {
  if (typeof window === "undefined") return;

  const metricName = metric.name.toLowerCase();
  if (["fcp", "lcp", "inp", "cls"].includes(metricName)) {
    recordClientMetric({ metric: metricName, value: metric.value, path: window.location.pathname });
  }
}

export default function WebVitalsReporter() {
  const pathname = usePathname();
  const navigationReported = useRef(false);
  useReportWebVitals((metric) => report(metric));

  useEffect(() => {
    if (pathname) recordClientMetric({ metric: "page_view", value: 1, path: pathname });
  }, [pathname]);

  useEffect(() => {
    if (navigationReported.current || typeof performance === "undefined") return;
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!entry) return;
    navigationReported.current = true;
    recordClientMetric({
      metric: "navigation_ttfb",
      value: Math.max(0, entry.responseStart - entry.requestStart),
      path: window.location.pathname,
    });
    recordClientMetric({
      metric: "navigation_total",
      value: Math.max(0, entry.loadEventEnd - entry.fetchStart),
      path: window.location.pathname,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;

    const startPerformanceObserver = () => {
      if (cancelled) return;
      // Resource and long-task observers are useful on public pages too, but
      // their code is not part of the first render. Protected pages already
      // share this singleton through PerformanceProvider.
      void import("@/lib/performance-monitor").then(({ getPerformanceMonitor }) => {
        if (!cancelled) getPerformanceMonitor();
      }).catch(() => undefined);
    };

    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(startPerformanceObserver, { timeout: 2_500 });
    } else {
      timeoutHandle = window.setTimeout(startPerformanceObserver, 1_500) as unknown as number;
    }

    return () => {
      cancelled = true;
      if (idleHandle !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
    };
  }, []);

  useEffect(() => {
    const flush = () => flushClientMetrics(true);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  return null;
}
