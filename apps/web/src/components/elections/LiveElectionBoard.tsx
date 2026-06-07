"use client";

import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  PauseCircle,
  Radio,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import BrandEmblem from "@/components/brand/BrandEmblem";
import { electionsApi } from "@/lib/api";
import { wsBase } from "@/lib/config";
import type { ElectionLiveSummary } from "@/lib/types";

const statusInfo = {
  draft: { label: "尚未開始", icon: CircleAlert, tone: "text-slate-300 bg-white/8" },
  live: { label: "開票進行中", icon: Radio, tone: "text-emerald-300 bg-emerald-400/10" },
  paused: { label: "暫停開票", icon: PauseCircle, tone: "text-amber-300 bg-amber-400/10" },
  closed: { label: "開票完成", icon: CheckCircle2, tone: "text-sky-300 bg-sky-400/10" },
};

export default function LiveElectionBoard({
  electionId,
  vertical = false,
}: {
  electionId: string;
  vertical?: boolean;
}) {
  const [summary, setSummary] = useState<ElectionLiveSummary | null>(null);
  const [connected, setConnected] = useState(false);

  const load = useCallback(() => {
    electionsApi.live(electionId).then(setSummary).catch(() => undefined);
  }, [electionId]);

  useEffect(() => {
    load();
    const socket = new WebSocket(
      `${wsBase()}/ws/public/elections/${encodeURIComponent(electionId)}`,
    );
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as {
          type: string;
          data?: ElectionLiveSummary;
        };
        if (message.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }));
        } else if (message.type === "election_update" && message.data) {
          setSummary(message.data);
        }
      } catch {
        // Ignore malformed frames and retain the last valid tally.
      }
    };
    const fallback = window.setInterval(load, 15_000);
    return () => {
      window.clearInterval(fallback);
      socket.close();
    };
  }, [electionId, load]);

  if (!summary) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#0d1f31] px-6 text-[#f8f3e5]">
        <div className="text-center">
          <RefreshCw className="mx-auto animate-spin text-[#e8c970]" size={28} aria-hidden />
          <p className="mt-4 text-sm text-[#cdd8e0]">正在載入開票資料...</p>
        </div>
      </div>
    );
  }

  const sortedCandidates = [...summary.candidates].sort((a, b) => b.votes - a.votes);
  const state = statusInfo[summary.status];
  const StatusIcon = state.icon;
  const totalBallotBoxes = summary.ballot_boxes.length;
  const completedBallotBoxes = summary.ballot_boxes.filter((box) => box.status === "locked").length;

  return (
    <main
      className={`min-h-screen bg-[#0d1f31] text-[#f8f3e5] ${
        vertical ? "mx-auto w-full max-w-[1080px]" : ""
      }`}
    >
      <div
        className={
          vertical
            ? "flex min-h-screen flex-col px-10 py-12 sm:px-14 sm:py-16"
            : "mx-auto max-w-[1480px] px-4 py-5 sm:px-7 sm:py-8 lg:px-10 lg:py-10"
        }
      >
        <nav className="mb-6 flex items-center justify-between gap-4">
          <Link
            href="/public/elections"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/15 px-3 text-sm font-medium text-[#cdd8e0] transition-colors hover:bg-white/8 hover:text-white"
          >
            <ArrowLeft size={16} aria-hidden />
            所有開票場次
          </Link>
          <div className="flex items-center gap-2 text-xs text-[#91a5b5]">
            <BrandEmblem size={30} priority />
            <span className="hidden sm:inline">HCCA 即時開票</span>
          </div>
        </nav>

        <header className="rounded-2xl border border-white/10 bg-[#173654] p-5 shadow-2xl shadow-black/20 sm:p-7 lg:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#e8c970]">
                HCCA Election Live
              </p>
              <h1 className={`${vertical ? "text-5xl" : "text-3xl sm:text-4xl lg:text-5xl"} mt-3 font-semibold leading-tight`}>
                {summary.title}
              </h1>
              <p className="mt-3 text-sm leading-6 text-[#aebeca]">
                票數由現場開票事件即時計算，頁面會自動更新。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              <span className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold ${state.tone}`}>
                <StatusIcon size={16} aria-hidden />
                {state.label}
              </span>
              <span className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/8 px-4 text-sm text-[#cdd8e0]">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`}
                  aria-hidden
                />
                {connected ? "即時連線" : "重新連線中"}
              </span>
            </div>
          </div>
          {summary.progress_percentage !== null && (
            <div className="mt-7">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-[#aebeca]">整體開票率</span>
                <strong className="text-lg tabular-nums text-[#e8c970]">
                  {summary.progress_percentage.toFixed(1)}%
                </strong>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#e8c970] transition-[width] duration-500"
                  style={{ width: `${Math.min(summary.progress_percentage, 100)}%` }}
                />
              </div>
            </div>
          )}
        </header>

        <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "已開票", value: summary.total_votes.toLocaleString("zh-TW") },
            { label: "有效票", value: summary.valid_votes.toLocaleString("zh-TW") },
            { label: "廢票", value: summary.invalid_votes.toLocaleString("zh-TW") },
            { label: "完成票匭", value: `${completedBallotBoxes} / ${totalBallotBoxes}` },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.045] p-4 sm:p-5">
              <p className="text-xs text-[#91a5b5]">{item.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums sm:text-3xl">{item.value}</p>
            </div>
          ))}
        </section>

        <section
          className={
            vertical
              ? "mt-8 flex flex-1 flex-col gap-6"
              : "mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.7fr)]"
          }
        >
          <div className="space-y-3">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.16em] text-[#e8c970]">RESULTS</p>
                <h2 className="mt-1 text-xl font-semibold">候選人得票</h2>
              </div>
              <p className="text-xs text-[#91a5b5]">依目前票數排序</p>
            </div>
            {sortedCandidates.map((candidate, index) => {
              const leader = candidate.candidate_id === summary.leader_candidate_id;
              const barWidth = summary.valid_votes > 0 ? candidate.percentage : 0;
              return (
                <article
                  key={candidate.candidate_id}
                  className={`overflow-hidden rounded-2xl border p-4 sm:p-5 ${
                    leader
                      ? "border-[#e8c970]/60 bg-[#e8c970]/[0.08]"
                      : "border-white/10 bg-white/[0.045]"
                  }`}
                >
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                    <div
                      className="grid h-12 w-12 place-items-center rounded-xl text-lg font-bold text-white shadow-lg sm:h-14 sm:w-14"
                      style={{ backgroundColor: candidate.color }}
                      aria-label={`${candidate.number} 號`}
                    >
                      {candidate.number}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div>
                          {candidate.members.length > 0 ? candidate.members.map((member) => (
                            <p key={member.id} className="flex flex-wrap items-baseline gap-2">
                              <span className="text-xs font-medium text-[#91a5b5] sm:text-sm">
                                {member.position}
                              </span>
                              <span className={`${vertical ? "text-3xl" : "text-lg sm:text-2xl"} font-semibold`}>
                                {member.name}
                              </span>
                            </p>
                          )) : (
                            <h3 className={`${vertical ? "text-3xl" : "text-lg sm:text-2xl"} truncate font-semibold`}>
                              {candidate.name}
                            </h3>
                          )}
                        </div>
                        {leader && index === 0 && summary.status !== "closed" && (
                          <span className="rounded-full bg-[#e8c970] px-2.5 py-1 text-[11px] font-bold text-[#173654]">
                            目前領先
                          </span>
                        )}
                      </div>
                      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full transition-[width] duration-500"
                          style={{ width: `${barWidth}%`, backgroundColor: candidate.color }}
                        />
                      </div>
                    </div>
                    <div className="col-span-2 flex items-baseline justify-end gap-2 sm:col-span-1 sm:block sm:min-w-32 sm:text-right">
                      <p className={`${vertical ? "text-5xl" : "text-3xl sm:text-4xl"} font-semibold tabular-nums`}>
                        {candidate.votes.toLocaleString("zh-TW")}
                      </p>
                      <p className="text-sm tabular-nums text-[#aebeca] sm:mt-1 sm:text-base">
                        {candidate.percentage.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <aside className={`${vertical ? "mt-auto" : ""} space-y-4`}>
            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <p className="text-xs font-semibold tracking-[0.16em] text-[#e8c970]">BALLOT BOXES</p>
              <h2 className="mt-1 text-lg font-semibold">票匭進度</h2>
              <div className="mt-4 space-y-3">
                {summary.ballot_boxes.map((box) => (
                  <div key={box.ballot_box_id} className="rounded-xl bg-black/10 p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium">{box.name}</p>
                      <span className="shrink-0 text-xs tabular-nums text-[#aebeca]">
                        {box.counted_votes.toLocaleString("zh-TW")}
                        {box.expected_total_votes !== null && ` / ${box.expected_total_votes.toLocaleString("zh-TW")}`}
                      </span>
                    </div>
                    {box.progress_percentage !== null && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-[#e8c970]"
                          style={{ width: `${Math.min(box.progress_percentage, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-5">
              <p className="text-xs text-[#91a5b5]">目前開票票匭</p>
              <p className="mt-2 text-base font-semibold leading-7">
                {summary.current_ballot_boxes.join("、") || "目前沒有票匭正在開票"}
              </p>
              {summary.expected_total_votes !== null && (
                <p className="mt-3 text-xs text-[#91a5b5]">
                  預計總票數 {summary.expected_total_votes.toLocaleString("zh-TW")}
                </p>
              )}
            </div>
          </aside>
        </section>

        <footer className={`${vertical ? "mt-10" : "mt-6"} flex flex-col gap-2 border-t border-white/10 pt-5 text-xs text-[#91a5b5] sm:flex-row sm:items-center sm:justify-between`}>
          <span>公開數據僅呈現已登錄的開票事件</span>
          <span>
            最後更新 {new Date(summary.last_updated_at).toLocaleString("zh-TW")}
          </span>
        </footer>
      </div>
    </main>
  );
}
