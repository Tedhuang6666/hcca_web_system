"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { ApiError, authApi } from "@/lib/api";
import { cacheCurrentUser, clearAuthCache } from "@/lib/auth-cache";
import { isPublicRoute } from "@/lib/route-access";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Public paths — skip auth check
    if (isPublicRoute(pathname)) {
      setReady(true);
      return;
    }

    setReady(false);
    authApi.me()
      .then((me) => {
        if (cancelled) return;
        cacheCurrentUser(me);
        setReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        // 網路短暫中斷或 API 5xx 不代表 session 失效；保留現有登入/權限快取，
        // 避免 transient failure 把使用者誤導回登入頁。
        const transientFailure = error instanceof ApiError
          && (error.status === 0 || error.status >= 500);
        if (transientFailure && localStorage.getItem("user_id")) {
          setReady(true);
          return;
        }
        clearAuthCache();
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      });

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  // SECURITY: 回傳 null（不渲染 children），避免受保護頁面在 auth 確認前出現在 DOM。
  // 若需防止畫面閃爍，在父層 layout 使用 CSS skeleton 或 loading spinner，
  // 不要在此回傳含 children 的 wrapper。
  if (!ready) return null;

  return <>{children}</>;
}
