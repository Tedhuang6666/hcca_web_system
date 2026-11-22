"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { PostHog } from "posthog-js/dist/module.slim";
import { analyticsApi } from "@/lib/api/analytics";
import { requiresAuthentication } from "@/lib/route-access";

let posthogPromise: Promise<PostHog> | null = null;
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const URL_PROPERTIES = ["$current_url", "$referrer", "$initial_current_url", "$initial_referrer"];

/** 去掉 query string 與 hash；兩者可能含退訂／登入 token、委託密鑰或搜尋關鍵字。 */
export function stripUrlSecrets(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

function ensureLoaded(key: string): Promise<PostHog> {
  if (!posthogPromise) {
    // 只使用 init/capture；slim build 不帶 session replay、surveys 等未使用模組。
    posthogPromise = import("posthog-js/dist/module.slim").then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_POSTHOG_HOST,
        capture_pageview: false,
        capture_pageleave: false,
        autocapture: false,
        disable_session_recording: true,
        persistence: "localStorage+cookie",
        before_send: (event) => {
          if (!event?.properties) return event;
          for (const name of URL_PROPERTIES) {
            const value = event.properties[name];
            if (typeof value === "string") event.properties[name] = stripUrlSecrets(value);
          }
          return event;
        },
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
    requestIdleCallback(capture, { timeout: 2_500 });
  } else {
    setTimeout(capture, 1_500);
  }
}

export default function TelemetryProvider() {
  const pathname = usePathname();
  const isFirstRender = useRef(true);

  useEffect(() => {
    // 只送出路徑，不送 query string（見 stripUrlSecrets）。
    const url = pathname;
    if (
      requiresAuthentication(pathname)
      && typeof window !== "undefined"
      && localStorage.getItem("user_id")
    ) {
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
  }, [pathname]);

  return null;
}
