"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { authApi } from "@/lib/api";
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
      .catch(() => {
        if (cancelled) return;
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
