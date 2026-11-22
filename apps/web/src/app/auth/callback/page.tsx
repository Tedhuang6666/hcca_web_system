"use client";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { authApi } from "@/lib/api";
import { cacheCurrentUser, clearAuthCache } from "@/lib/auth-cache";
import { safeNextPath } from "@/lib/safe-redirect";
import { loginDestination } from "@/lib/login-destination";

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

    // /api/auth/me 取得 401 時會依 localStorage 的 user_id 靜默刷新；若 callback
    // 的新 cookie 尚未到位，舊 refresh cookie 會把前一個帳號續回來。
    clearAuthCache();

    // Google callback 已在 API response 設定 HttpOnly cookies，但公開頁面不會
    // 經過受保護 layout，因此仍需同步本機登入快取，讓問卷等公開頁面知道目前
    // 是登入狀態。
    //
    // 307 redirect 的 Set-Cookie 有時比 JS 的第一次 XHR 晚到（約 400ms），
    // 造成 /auth/me 以 q=0 回傳 401。等候一次後 token 即可用，故 retry 一次。
    const fetchMe = () => authApi.me().catch(async (err) => {
      await new Promise<void>((r) => setTimeout(r, 400));
      return authApi.me().catch(() => Promise.reject(err));
    });

    void fetchMe()
      .then((user) => {
        cacheCurrentUser(user);
        window.location.replace(loginDestination(next));
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
    <div className="min-h-dvh flex items-center justify-center"
      style={{ background: "var(--primary-fg)" }}>
      <div className="text-center space-y-3">
        <Loader2 size={40} className="mx-auto animate-spin" style={{ color: "var(--primary-text)" }} aria-label="載入中" />
        <p className="text-slate-400 text-sm">正在完成登入...</p>
      </div>
    </div>
  );
}
