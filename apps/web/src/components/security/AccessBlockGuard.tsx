"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { apiUrl } from "@/lib/config";

export default function AccessBlockGuard() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/blocked") return;
    let cancelled = false;

    async function checkAccess() {
      try {
        const response = await fetch(apiUrl("/system/access-status"), {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;
        const state = (await response.json()) as {
          blocked?: boolean;
          reason?: string;
          expires_at?: number | null;
        };
        if (!state.blocked || cancelled) return;
        const params = new URLSearchParams();
        if (state.reason) params.set("reason", state.reason);
        if (state.expires_at) params.set("until", String(state.expires_at));
        window.location.replace(`/blocked?${params.toString()}`);
      } catch {
        // 狀態檢查失敗不應中斷目前頁面。
      }
    }

    void checkAccess();
    const timer = window.setInterval(checkAccess, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pathname]);

  return null;
}
