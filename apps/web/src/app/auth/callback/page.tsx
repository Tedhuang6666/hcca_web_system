"use client";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { cacheCurrentUser } from "@/lib/auth-cache";
import { apiUrl } from "@/lib/config";
import { safeNextPath } from "@/lib/safe-redirect";

// Refresh token 會輪替；若 callback 因重新掛載或多個 effect 同時啟動，
// 只能讓一個請求消耗舊 token，否則後發請求會被視為重放而回 401。
let refreshFromCookiePromise: Promise<boolean> | null = null;

export default function AuthCallbackPage() {
  const searchParams = useSearchParams();
  const bootstrapStarted = useRef(false);

  useEffect(() => {
    // React Strict Mode 會在開發環境重跑 effect；登入 callback 不能因此同時
    // 旋轉兩次 refresh token，否則第一次登入會被其中一個競態請求判定失敗。
    if (bootstrapStarted.current) return;
    bootstrapStarted.current = true;

    const error = searchParams.get("error");
    const next = safeNextPath(searchParams.get("next"));
    const retryDelays = [100, 250, 500];

    const waitBeforeRetry = (attempt: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, retryDelays[attempt] ?? 500));

    async function fetchMeFromCookie(): Promise<boolean> {
      for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        try {
          const res = await fetch(apiUrl("/auth/me"), {
            credentials: "include",
            cache: "no-store",
          });
          if (res.ok) {
            const me = await res.json();
            if (me?.id) {
              cacheCurrentUser(me);
              return true;
            }
          }
        } catch {
          // OAuth 回呼剛完成時，反向代理或 cookie store 可能尚未穩定；繼續短暫重試。
        }
        if (attempt < retryDelays.length) await waitBeforeRetry(attempt);
      }
      return false;
    }

    async function refreshFromCookie(): Promise<boolean> {
      if (refreshFromCookiePromise) return refreshFromCookiePromise;

      refreshFromCookiePromise = (async () => {
        try {
          const csrfToken = document.cookie
            .split(";")
            .map((c) => c.trim())
            .find((c) => c.startsWith("csrf_token="))
            ?.slice("csrf_token=".length);
          const res = await fetch(apiUrl("/auth/refresh"), {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: csrfToken ? { "X-CSRF-Token": decodeURIComponent(csrfToken) } : {},
          });
          return res.ok;
        } catch {
          return false;
        } finally {
          refreshFromCookiePromise = null;
        }
      })();

      return refreshFromCookiePromise;
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
        <Loader2 size={40} className="mx-auto animate-spin" style={{ color: "var(--primary)" }} aria-label="載入中" />
        <p className="text-slate-400 text-sm">正在完成登入...</p>
      </div>
    </div>
  );
}
