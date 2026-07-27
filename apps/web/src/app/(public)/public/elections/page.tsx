import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, PauseCircle, Radio } from "lucide-react";

import { serverApiUrl } from "@/lib/config";

type PublicElection = {
  id: string;
  title: string;
  slug: string | null;
  status: "live" | "paused" | "closed";
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

const STATUS = {
  live: {
    label: "開票進行中",
    description: "票數會自動更新，不需要重新整理頁面。",
    icon: Radio,
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  paused: {
    label: "暫停開票",
    description: "現場暫停輸入，頁面保留最後一次公開結果。",
    icon: PauseCircle,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  closed: {
    label: "開票完成",
    description: "開票程序已結束，可查看最終公開票數。",
    icon: CheckCircle2,
    className: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
};

export const metadata: Metadata = {
  title: "即時開票",
  description: "查看學生自治選舉的即時開票進度與公開結果。",
};

async function fetchPublicElections(): Promise<PublicElection[]> {
  try {
    const response = await fetch(serverApiUrl("/elections/public"), {
      next: { revalidate: 15 },
    });
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

export default async function PublicElectionsPage() {
  const elections = await fetchPublicElections();
  const liveCount = elections.filter((election) => election.status === "live").length;

  return (
    <div className="space-y-8 pb-8">
      <header className="rounded-2xl bg-[#173654] px-6 py-9 text-[#f8f3e5] sm:px-9">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-[#e8c970]">
              ELECTION LIVE
            </p>
            <h1 className="mt-3 font-serif text-3xl font-semibold sm:text-4xl" style={{ color: "#f8f3e5" }}>即時開票中心</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[#cdd8e0] sm:text-base">
              集中查看目前進行中、暫停或已完成的公開選舉。票數由現場開票紀錄即時計算。
            </p>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/5 px-5 py-4">
            <p className="text-xs text-[#aebeca]">目前進行中</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-[#e8c970]">{liveCount}</p>
          </div>
        </div>
      </header>

      {elections.length === 0 ? (
        <section className="rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] px-6 py-16 text-center">
          <Radio className="mx-auto text-[var(--public-muted)]" size={30} aria-hidden />
          <h2 className="mt-4 text-lg font-semibold">目前沒有公開開票場次</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--public-secondary)]">
            選舉進入開票或完成後，公開結果會顯示在這裡。
          </p>
        </section>
      ) : (
        <section className="grid gap-4">
          {elections.map((election) => {
            const state = STATUS[election.status];
            const Icon = state.icon;
            return (
              <Link
                key={election.id}
                href={`/live/elections/${encodeURIComponent(election.slug ?? election.id)}`}
                className="group rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] p-5 transition-colors hover:border-[var(--public-accent)] hover:bg-[var(--public-soft)] sm:p-6"
              >
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <span
                      className={`inline-flex min-h-8 items-center gap-2 rounded-full px-3 text-xs font-semibold ${state.className}`}
                    >
                      <Icon size={14} aria-hidden />
                      {state.label}
                    </span>
                    <h2 className="mt-4 text-xl font-semibold leading-snug sm:text-2xl">
                      {election.title}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--public-secondary)]">
                      {state.description}
                    </p>
                    <p className="mt-3 text-xs text-[var(--public-muted)]">
                      更新於 {new Date(election.updated_at).toLocaleString("zh-TW")}
                    </p>
                  </div>
                  <span className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--public-accent)] px-4 text-sm font-semibold text-[var(--primary-fg)]">
                    查看開票
                    <ArrowRight size={16} aria-hidden />
                  </span>
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </div>
  );
}
