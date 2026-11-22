"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BrandEmblem from "@/components/brand/BrandEmblem";

type MaintenanceState = {
  enabled: boolean;
  message: string;
};

function MaintenanceContent() {
  const router = useRouter();
  const params = useSearchParams();
  const kind = params.get("kind") ?? "maintenance";
  const rawDetail = params.get("detail") ?? "";
  const initialDetail = (() => {
    try {
      return decodeURIComponent(rawDetail);
    } catch {
      return rawDetail;
    }
  })();
  const initialRetry = Math.max(5, Math.min(120, parseInt(params.get("retry") ?? "30", 10) || 30));
  const [countdown, setCountdown] = useState(initialRetry);
  const [liveDetail, setLiveDetail] = useState(initialDetail);

  useEffect(() => {
    if (countdown <= 0) {
      // 指數退避：每次重試後延長下一輪倒數，避免雷鳴
      router.back();
      return;
    }
    const t = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, router]);

  useEffect(() => {
    let cancelled = false;

    async function refreshMaintenanceState() {
      try {
        const res = await fetch("/api/system/maintenance", {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) return;
        const state = (await res.json()) as MaintenanceState;
        if (cancelled) return;
        setLiveDetail(state.message || "");
        if (!state.enabled && kind === "maintenance") router.replace("/");
      } catch {
        // 維護頁本身不能因狀態查詢失敗而閃爍或跳走。
      }
    }

    refreshMaintenanceState();
    const timer = setInterval(refreshMaintenanceState, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [kind, router]);

  const title = kind === "maintenance" ? "系統維護中" : "全站防護模式啟動";
  const subtitle =
    kind === "maintenance"
      ? ""
      : "系統已啟動防護措施，請稍後再試。";

  return (
    <main className="min-h-screen bg-[var(--bg-base)] px-5 text-[var(--text-primary)] sm:px-8">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col">
        <header className="flex items-center gap-3 border-b-2 border-[var(--text-primary)] py-5">
          <div className="flex items-center gap-3">
            <BrandEmblem size={44} priority />
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">新竹高中班聯會</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">數位整合系統</div>
            </div>
          </div>
        </header>

        <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center py-20 sm:py-24">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-semibold leading-[1.16] tracking-tight text-[var(--text-primary)] sm:text-5xl md:text-6xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-5 max-w-[65ch] text-lg leading-8 text-[var(--text-secondary)]">
                {subtitle}
              </p>
            )}
            {liveDetail && (
              <p className="mt-6 max-w-[65ch] break-words text-base leading-7 text-[var(--text-secondary)]">
                {liveDetail}
              </p>
            )}
          </div>
        </section>

        <footer className="border-t border-[var(--border)] py-4 text-xs text-[var(--text-muted)]">
          新竹高中班聯會數位整合系統
        </footer>
      </div>
    </main>
  );
}

function MaintenanceFallback() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--bg-base)] px-5 text-[var(--text-primary)]">
      <p className="text-sm text-[var(--text-muted)]">正在載入系統狀態…</p>
    </main>
  );
}

export default function MaintenancePage() {
  return (
    <Suspense fallback={<MaintenanceFallback />}>
      <MaintenanceContent />
    </Suspense>
  );
}
