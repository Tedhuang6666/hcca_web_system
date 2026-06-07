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

  if (!ready) {
    // 閃爍防護：顯示空白直到 auth 確認完成
    return (
      <div className="min-h-screen" style={{ background: "var(--primary-fg)" }} />
    );
  }

  return <>{children}</>;
}
