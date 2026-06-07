"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Home, RotateCcw, ShieldAlert, Wrench } from "lucide-react";
import BrandEmblem from "@/components/brand/BrandEmblem";

type MaintenanceState = {
  enabled: boolean;
  message: string;
  until: number | null;
};

function MaintenanceContent() {
  const router = useRouter();
  const params = useSearchParams();
  const kind = params.get("kind") ?? "maintenance";
  const rawDetail = params.get("detail") ?? "";
  const initialUntil = Number(params.get("until") ?? 0) || null;
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
  const [liveUntil, setLiveUntil] = useState<number | null>(initialUntil);

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
        setLiveUntil(state.until ?? null);
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
      ? "管理員正在進行系統維護或緊急處置，一般請求暫時停止服務。"
      : "系統偵測到高流量或端點保護策略，已優先保留管理員與緊急處理通道。";
  const Icon = kind === "maintenance" ? Wrench : ShieldAlert;
  const statusRows = [
    ["入口網站", kind === "maintenance" ? "暫停一般流量" : "防護策略生效"],
    ["管理通道", "保留"],
    ["預計恢復", liveUntil ? new Date(liveUntil * 1000).toLocaleString() : "待管理員確認"],
    ["自動重試", `${countdown}s`],
  ];

  return (
    <main className="min-h-screen bg-[var(--bg-base)] px-5 py-6 text-[var(--text-primary)] md:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col justify-between">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandEmblem size={42} framed priority />
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">校園自治平台</div>
              <div className="text-xs text-[var(--text-muted)]">HCCA System Status</div>
            </div>
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)]">
            {kind === "maintenance" ? "MAINTENANCE" : "PROTECTED"}
          </div>
        </header>

        <section className="grid gap-5 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-[var(--warning-border)] bg-[var(--warning-dim)] px-3 py-1.5 text-sm font-medium text-[var(--warning)]">
              <Icon size={16} aria-hidden />
              服務狀態更新
            </div>
            <h1 className="text-4xl font-semibold leading-tight text-[var(--text-primary)] md:text-5xl">
              {title}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-[var(--text-secondary)]">
              {subtitle}
            </p>
            {liveDetail && (
              <p className="mt-5 max-w-xl rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-sm leading-6 text-[var(--text-secondary)] shadow-sm">
                {liveDetail}
              </p>
            )}

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => router.back()}
                className="btn btn-primary h-11 px-5"
              >
                <RotateCcw size={16} aria-hidden />
                立即重試
              </button>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="btn btn-ghost h-11 px-5"
              >
                <Home size={16} aria-hidden />
                返回首頁
              </button>
            </div>
          </div>

          <aside className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-sm">
            <div className="flex items-end justify-between gap-4 border-b border-[var(--border)] pb-4">
              <div>
                <div className="text-sm font-medium text-[var(--text-muted)]">Retry-After</div>
                <div className="mt-1 font-mono text-5xl font-semibold leading-none text-[var(--text-primary)]">
                  {countdown}
                  <span className="ml-1 text-base text-[var(--text-muted)]">s</span>
                </div>
              </div>
              <div className="grid h-14 w-14 place-items-center rounded-lg bg-[var(--primary-dim)] text-[var(--primary)]">
                <Icon size={24} aria-hidden />
              </div>
            </div>

            <div className="mt-4 divide-y divide-[var(--border)]">
              {statusRows.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 py-3">
                  <span className="text-sm text-[var(--text-muted)]">{label}</span>
                  <span className="text-sm font-medium text-[var(--text-primary)]">{value}</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => router.back()}
              className="btn btn-ghost mt-5 w-full"
            >
              <ArrowLeft size={16} aria-hidden />
              回到上一頁
            </button>
          </aside>
        </section>

        <footer className="border-t border-[var(--border)] py-4 text-xs text-[var(--text-muted)]">
          HCCA Campus Self-Governance Platform
        </footer>
      </div>
    </main>
  );
}

export default function MaintenancePage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <MaintenanceContent />
    </Suspense>
  );
}
