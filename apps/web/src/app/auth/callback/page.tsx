"use client";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { authApi } from "@/lib/api";
import { cacheCurrentUser } from "@/lib/auth-cache";
import { safeNextPath } from "@/lib/safe-redirect";

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

    if (error) {
      window.location.replace(`/login?error=${encodeURIComponent(error)}`);
      return;
    }

    // Google callback 已在 API response 設定 HttpOnly cookies，但公開頁面不會
    // 經過受保護 layout，因此仍需同步本機登入快取，讓問卷等公開頁面知道目前
    // 是登入狀態。這裡只查詢一次 /auth/me，不主動刷新 token。
    void authApi.me()
      .then((user) => {
        cacheCurrentUser(user);
        window.location.replace(next);
      })
      .catch(() => {
        const query = new URLSearchParams({
          error: "登入狀態同步失敗，請重新登入",
          next,
        });
        window.location.replace(`/login?${query.toString()}`);
      });
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
