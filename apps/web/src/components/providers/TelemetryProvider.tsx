"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { PostHog } from "posthog-js";
import { analyticsApi } from "@/lib/api";

let posthogPromise: Promise<PostHog> | null = null;

function ensureLoaded(key: string): Promise<PostHog> {
  if (!posthogPromise) {
    posthogPromise = import("posthog-js").then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com",
        capture_pageview: false,
        persistence: "localStorage+cookie",
      });
      return posthog;
    });
  }
  return posthogPromise;
}

/** 首屏延到瀏覽器 idle 才載入 posthog-js（省 ~64KB gzip），在此之前的 pageview 先排隊。 */
function schedulePageview(key: string, url: string) {
  const capture = () => ensureLoaded(key).then((posthog) => posthog.capture("$pageview", { $current_url: url }));
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(capture);
  } else {
    setTimeout(capture, 1);
  }
}

export default function TelemetryProvider() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isFirstRender = useRef(true);

  useEffect(() => {
    const query = searchParams.toString();
    const url = query ? `${pathname}?${query}` : pathname;
    if (typeof window !== "undefined" && localStorage.getItem("user_id")) {
      void analyticsApi.trackPageView(pathname).catch(() => undefined);
    }

    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;

    if (isFirstRender.current) {
      isFirstRender.current = false;
      schedulePageview(key, url);
      return;
    }
    // 已初始化過就直接送，不用再等 idle
    ensureLoaded(key).then((posthog) => posthog.capture("$pageview", { $current_url: url }));
  }, [pathname, searchParams]);

  return null;
}
