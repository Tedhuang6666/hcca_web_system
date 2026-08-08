"use client";

import Link from "next/link";
import { ArrowRight, Radio } from "lucide-react";
import { useEffect, useState } from "react";

import { liveLeader, useLiveElection } from "@/components/site/useLiveElection";

export default function LiveElectionCard({ standalone = false }: { standalone?: boolean }) {
  const [ready, setReady] = useState(false);
  const activeElection = useLiveElection(25_000, ready);

  useEffect(() => {
    let idleId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(() => setReady(true), { timeout: 1_000 });
      } else {
        setReady(true);
      }
    }, 3_000);
    return () => {
      window.clearTimeout(timeoutId);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
    };
  }, []);

  if (!activeElection) return null;

  const liveSummary = activeElection.summary;
  const liveLeading = liveLeader(liveSummary);

  const card = (
    <Link
      href={`/live/elections/${encodeURIComponent(activeElection.summary?.slug ?? activeElection.id)}`}
      className="group overflow-hidden rounded-2xl bg-[#173654] p-6 text-[#f8f3e5] shadow-lg shadow-slate-950/10 transition-colors hover:bg-[#1d4265] sm:p-8"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="inline-flex min-h-9 items-center gap-2 rounded-full bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden />
          {activeElection.status === "live" ? "即時開票中" : "開票暫停"}
        </span>
        <Radio size={22} className="text-[#e8c970]" aria-hidden />
      </div>
      <h3 className="mt-8 font-serif text-2xl font-semibold leading-snug sm:text-3xl" style={{ color: "#f8f3e5" }}>
        {activeElection.title}
      </h3>
      {liveSummary ? (
        <>
          <div className="mt-5 flex flex-wrap gap-2">
            {typeof liveSummary.progress_percentage === "number" && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
                開票進度 {Math.round(liveSummary.progress_percentage)}%
              </span>
            )}
            {liveLeading && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
                領先 {liveLeading.name} {Math.round(liveLeading.percentage)}%
              </span>
            )}
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
              已開 {liveSummary.total_votes.toLocaleString("zh-TW")} 票
            </span>
          </div>
          <div className="mt-4 space-y-2.5">
            {liveSummary.candidates.slice(0, 3).map((candidate) => (
              <div key={candidate.candidate_id}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{candidate.number}. {candidate.name}</span>
                  <span className="text-[#cdd8e0]">
                    {candidate.votes.toLocaleString("zh-TW")} 票 · {Math.round(candidate.percentage)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${Math.min(100, candidate.percentage)}%`, background: candidate.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-3 max-w-xl text-sm leading-7 text-[#cdd8e0]">
          查看候選人得票、整體開票率與各票匭進度，頁面會自動同步現場紀錄。
        </p>
      )}
      <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#e8c970]">
        前往即時開票看完整票數
        <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" aria-hidden />
      </span>
    </Link>
  );

  if (!standalone) return card;

  return (
    <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6" aria-labelledby="public-live-title" data-reveal>
      <div className="mb-5 flex items-end justify-between gap-4">
        <h2 id="public-live-title" className="text-2xl font-semibold sm:text-3xl">最新動態</h2>
        <Link href="/news" className="public-text-link">查看全部公告</Link>
      </div>
      {card}
    </section>
  );
}
