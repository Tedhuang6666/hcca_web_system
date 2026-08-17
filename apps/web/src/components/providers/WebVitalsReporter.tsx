"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { useEffect, useRef } from "react";
import { flushClientMetrics, observeInteractions, recordClientMetric } from "@/lib/client-metrics";

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

  useEffect(() => observeInteractions(), []);

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
    const flush = () => flushClientMetrics(true);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  return null;
}
