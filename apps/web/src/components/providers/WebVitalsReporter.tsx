"use client";

import { useReportWebVitals } from "next/web-vitals";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const ANONYMOUS_ID_KEY = "hcca:posthog-anonymous-id";

function anonymousId(): string {
  try {
    const existing = localStorage.getItem(ANONYMOUS_ID_KEY);
    if (existing) return existing;
    const value = crypto.randomUUID();
    localStorage.setItem(ANONYMOUS_ID_KEY, value);
    return value;
  } catch {
    return "hcca-anonymous";
  }
}

function report(metric: {
  id: string;
  name: string;
  value: number;
  delta: number;
  rating?: string;
  navigationType?: string;
}) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof window === "undefined") return;

  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_POSTHOG_HOST;
  const body = JSON.stringify({
    api_key: key,
    event: "web_vital",
    properties: {
      distinct_id: anonymousId(),
      $current_url: window.location.href,
      metric_id: metric.id,
      metric_name: metric.name,
      value: metric.value,
      delta: metric.delta,
      rating: metric.rating,
      navigation_type: metric.navigationType,
      environment: process.env.NEXT_PUBLIC_ENVIRONMENT || process.env.NODE_ENV,
    },
  });

  if (navigator.sendBeacon) {
    const accepted = navigator.sendBeacon(
      `${host}/capture/`,
      new Blob([body], { type: "application/json" }),
    );
    if (accepted) return;
  }
  void fetch(`${host}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export default function WebVitalsReporter() {
  useReportWebVitals((metric) => report(metric));
  return null;
}
