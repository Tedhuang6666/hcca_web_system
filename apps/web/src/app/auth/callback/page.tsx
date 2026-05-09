"use client";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

import { cacheCurrentUser } from "@/lib/auth-cache";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function AuthCallbackPage() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const error = searchParams.get("error");
    const next = searchParams.get("next") || "/";

    async function fetchMeFromCookie() {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          credentials: "include",
        });
        const me = await res.json();
        if (me?.id) {
          cacheCurrentUser(me);
        }
      } catch {
        // 忽略 userinfo 補資料失敗，避免 callback 卡住。
      } finally {
        window.location.replace(next);
      }
    }

    async function bootstrapFromCookie() {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          throw new Error("refresh failed");
        }
        await fetchMeFromCookie();
      } catch {
        window.location.replace("/login?error=缺少 Token，請重新登入");
      }
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
