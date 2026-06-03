"use client";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

import { cacheCurrentUser } from "@/lib/auth-cache";
import { apiUrl } from "@/lib/config";
import { safeNextPath } from "@/lib/safe-redirect";

export default function AuthCallbackPage() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const error = searchParams.get("error");
    const next = safeNextPath(searchParams.get("next"));

    async function fetchMeFromCookie(): Promise<boolean> {
      try {
        const res = await fetch(apiUrl("/auth/me"), {
          credentials: "include",
        });
        if (!res.ok) return false;
        const me = await res.json();
        if (me?.id) {
          cacheCurrentUser(me);
          return true;
        }
      } catch {
        // 交由 refresh fallback 處理，避免 callback 卡住。
      }
      return false;
    }

    async function refreshFromCookie(): Promise<boolean> {
      try {
        const res = await fetch(apiUrl("/auth/refresh"), {
          method: "POST",
          credentials: "include",
        });
        return res.ok;
      } catch {
        return false;
      }
    }

    async function bootstrapFromCookie() {
      if (await fetchMeFromCookie()) {
        window.location.replace(next);
        return;
      }

      if (await refreshFromCookie() && await fetchMeFromCookie()) {
        window.location.replace(next);
        return;
      }

      window.location.replace("/login?error=缺少 Token，請重新登入");
    }

    if (error) {
      window.location.replace(`/login?error=${encodeURIComponent(error)}`);
      return;
    }

    void bootstrapFromCookie();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--primary-fg)" }}>
      <div className="text-center space-y-3">
        <div className="w-10 h-10 border-2 border-t-transparent rounded-full animate-spin mx-auto"
          style={{ borderColor: "var(--primary)", borderTopColor: "transparent" }} />
        <p className="text-slate-400 text-sm">正在完成登入...</p>
      </div>
    </div>
  );
}
