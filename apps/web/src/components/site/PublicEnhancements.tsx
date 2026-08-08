"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

function capturePageview(key: string, url: string) {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_POSTHOG_HOST;
  const storageKey = "hcca:posthog-anonymous-id";
  let distinctId = "hcca-anonymous";

  try {
    distinctId = localStorage.getItem(storageKey) || crypto.randomUUID();
    localStorage.setItem(storageKey, distinctId);
  } catch {
    // 無法使用儲存空間時仍送出不持久化的匿名 pageview。
  }

  const body = JSON.stringify({
    api_key: key,
    event: "$pageview",
    properties: { distinct_id: distinctId, $current_url: url },
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

export default function PublicEnhancements() {
  const pathname = usePathname();

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;

    let cancelled = false;
    const run = () => {
      if (!cancelled) capturePageview(key, window.location.href);
    };

    let idleId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(run, { timeout: 1_000 });
      } else {
        run();
      }
    }, 3_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
    };
  }, [pathname]);

  return null;
}
