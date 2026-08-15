"use client";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

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

    // Google callback 已在 API response 設定 HttpOnly cookies。這裡不再重複
    // 呼叫 /auth/me → /auth/refresh → /auth/me；直接進入目標頁，由受保護
    // layout 的單次 server session check 完成身分驗證。
    window.location.replace(next);
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
