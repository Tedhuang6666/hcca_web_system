import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, PauseCircle, Radio } from "lucide-react";

import { fetchPublicJson } from "@/lib/serverFetch";

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
    className: "election-status election-status-live",
  },
  paused: {
    label: "暫停開票",
    description: "現場暫停輸入，頁面保留最後一次公開結果。",
    icon: PauseCircle,
    className: "election-status election-status-paused",
  },
  closed: {
    label: "開票完成",
    description: "開票程序已結束，可查看最終公開票數。",
    icon: CheckCircle2,
    className: "election-status election-status-closed",
  },
};

export const metadata: Metadata = {
  title: "即時開票",
  description: "查看學生自治選舉的即時開票進度與公開結果。",
};

async function fetchPublicElections(): Promise<PublicElection[]> {
  return (await fetchPublicJson<PublicElection[]>("/elections/public", { revalidate: 15 })) ?? [];
}

export default async function PublicElectionsPage() {
  const elections = await fetchPublicElections();

  return (
    <div className="elections-page space-y-8 pb-8">
      <header className="elections-page-head max-w-3xl">
        <h1 className="font-serif text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">即時開票</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--public-secondary)] sm:text-base">
          查看進行中、暫停或已完成的公開選舉，票數會隨現場開票紀錄更新。
        </p>
      </header>

      {elections.length === 0 ? (
        <section className="elections-empty-state">
          <Radio className="mx-auto text-[var(--public-muted)]" size={30} aria-hidden />
          <h2 className="mt-4 text-lg font-semibold">目前沒有公開開票場次</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--public-secondary)]">
            選舉進入開票或完成後，公開結果會顯示在這裡。
          </p>
        </section>
      ) : (
        <section className="election-list" aria-label="公開選舉列表">
          {elections.map((election) => {
            const state = STATUS[election.status];
            const Icon = state.icon;
            return (
              <Link
                key={election.id}
                href={`/live/elections/${encodeURIComponent(election.slug ?? election.id)}`}
                className="election-list-item group"
              >
                <div className="min-w-0">
                  <span className={state.className}>
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
                    <time dateTime={election.updated_at}>
                      更新於 {new Date(election.updated_at).toLocaleString("zh-TW")}
                    </time>
                  </p>
                </div>
                <span className="election-list-cta">
                  查看開票
                  <ArrowRight size={16} aria-hidden />
                </span>
              </Link>
            );
          })}
        </section>
      )}
    </div>
  );
}
