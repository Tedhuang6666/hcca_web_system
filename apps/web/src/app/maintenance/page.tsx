"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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
    { label: "入口網站", value: kind === "maintenance" ? "暫停一般流量" : "防護策略生效" },
    { label: "管理通道", value: "保留" },
    {
      label: "預計恢復",
      value: liveUntil
        ? new Date(liveUntil * 1000).toLocaleString("zh-TW", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "待管理員確認",
    },
  ];

  return (
    <main className="min-h-screen border-t-2 border-[var(--primary)] bg-[var(--bg-base)] px-5 py-6 text-[var(--text-primary)] sm:px-8 lg:px-12">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-7xl flex-col">
        <header className="flex items-start justify-between gap-6 border-b border-[var(--border)] pb-5">
          <div className="flex min-w-0 items-center gap-3">
            <BrandEmblem size={42} priority />
            <div>
              <div className="text-sm font-semibold tracking-[0.02em] text-[var(--text-primary)]">
                新竹高中班聯會
              </div>
              <div className="mt-0.5 text-xs text-[var(--text-muted)]">HCCA · 校園自治整合平台</div>
            </div>
          </div>
          <div className="hidden items-center gap-3 pt-2 text-xs font-medium tracking-[0.16em] text-[var(--text-muted)] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]" aria-hidden />
            SYSTEM STATUS
          </div>
        </header>

        <section className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.75fr)] lg:gap-20 lg:py-16">
          <div className="max-w-2xl">
            <div className="mb-6 flex items-center gap-2 text-sm font-semibold text-[var(--warning)]" role="status">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--warning-dim)]" aria-hidden>
                <Icon size={15} />
              </span>
              {kind === "maintenance" ? "系統維護中" : "防護模式啟動"}
            </div>
            <h1 className="max-w-[12ch] text-[clamp(2.8rem,7vw,5.8rem)] font-semibold leading-[1.04] tracking-[-0.045em] text-[var(--text-primary)]">
              {title}
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-[var(--text-secondary)]">
              {subtitle}
            </p>
            {liveDetail && (
              <p className="mt-7 max-w-xl border-y border-[var(--border)] py-4 text-sm leading-7 text-[var(--text-secondary)]">
                {liveDetail}
              </p>
            )}

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => router.back()}
                className="btn btn-primary min-h-11 justify-center px-5 sm:justify-start"
              >
                <RotateCcw size={16} aria-hidden />
                立即重試
              </button>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="btn btn-ghost min-h-11 justify-center px-5 sm:justify-start"
              >
                <Home size={16} aria-hidden />
                返回首頁
              </button>
            </div>
            <Link
              href="/admin/system"
              className="mt-5 inline-flex min-h-11 items-center text-sm font-medium text-[var(--primary-text)] underline decoration-[var(--primary)] underline-offset-4 transition-colors hover:text-[var(--text-primary)]"
            >
              前往管理員控制台（需管理員權限）
            </Link>
          </div>

          <aside className="w-full max-w-xl justify-self-start border border-[var(--border)] bg-[var(--bg-surface)] lg:justify-self-end">
            <div className="border-b border-[var(--border)] px-5 py-4 sm:px-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <span className="h-2 w-2 rounded-full bg-[var(--primary)]" aria-hidden />
                  服務狀態
                </div>
                <span className="text-xs font-medium tracking-[0.12em] text-[var(--text-muted)]">
                  {kind === "maintenance" ? "MAINTENANCE" : "PROTECTED"}
                </span>
              </div>
            </div>

            <div className="px-5 py-6 sm:px-6">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-xs font-medium tracking-[0.08em] text-[var(--text-muted)]">下次自動重試</div>
                  <div className="mt-2 font-mono text-5xl font-semibold leading-none tabular-nums text-[var(--text-primary)]" aria-live="polite">
                    {countdown}
                    <span className="ml-2 text-base font-sans font-medium text-[var(--text-muted)]">秒</span>
                  </div>
                </div>
                <div className="grid h-12 w-12 place-items-center rounded-full border border-[var(--warning-border)] bg-[var(--warning-dim)] text-[var(--warning)]">
                  <Icon size={21} aria-hidden />
                </div>
              </div>

              <div className="mt-7 divide-y divide-[var(--border)] border-t border-[var(--border)]">
                {statusRows.map(({ label, value }) => (
                  <div key={label} className="flex items-start justify-between gap-5 py-3.5">
                    <span className="text-sm text-[var(--text-muted)]">{label}</span>
                    <span className="text-right text-sm font-medium text-[var(--text-primary)]">{value}</span>
                  </div>
                ))}
              </div>

              <p className="mt-5 text-xs leading-6 text-[var(--text-muted)]">
                資料與已完成的作業都受到保護，不會因本次維護遺失。
              </p>

              <button
                type="button"
                onClick={() => router.back()}
                className="btn btn-ghost mt-5 min-h-11 w-full justify-center border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
              >
                <ArrowLeft size={16} aria-hidden />
                回到上一頁
              </button>
            </div>
          </aside>
        </section>

        <footer className="flex flex-col gap-1 border-t border-[var(--border)] py-5 text-xs text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between">
          <span>HCCA Campus Self-Governance Platform</span>
          <span>服務恢復後將自動返回原頁面</span>
        </footer>
      </div>
    </main>
  );
}

function MaintenanceFallback() {
  return (
    <main className="grid min-h-screen place-items-center border-t-2 border-[var(--primary)] bg-[var(--bg-base)] px-5 text-[var(--text-primary)]">
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
