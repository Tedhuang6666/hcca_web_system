"use client";

import { useCallback, useEffect, useState } from "react";
import { electionsApi } from "@/lib/api";
import { wsBase } from "@/lib/config";
import type { ElectionLiveSummary } from "@/lib/types";

const statusText = {
  draft: "尚未開始",
  live: "開票進行中",
  paused: "暫停開票",
  closed: "開票完成",
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
      <div className="min-h-screen grid place-items-center bg-slate-950 text-white">
        正在載入開票資料…
      </div>
    );
  }

  const sortedCandidates = [...summary.candidates].sort((a, b) => b.votes - a.votes);
  return (
    <main
      className={`min-h-screen bg-slate-950 text-white ${
        vertical ? "w-full max-w-[1080px] mx-auto" : ""
      }`}
    >
      <div className={vertical ? "min-h-screen px-14 py-16 flex flex-col" : "p-8 lg:p-12"}>
        <header className="flex items-start justify-between gap-6 border-b border-white/15 pb-7">
          <div>
            <p className="text-cyan-300 font-semibold tracking-[0.22em] uppercase">
              HCCA Election Live
            </p>
            <h1 className={`${vertical ? "text-5xl" : "text-4xl lg:text-6xl"} font-bold mt-3`}>
              {summary.title}
            </h1>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end gap-2 text-sm text-slate-300">
              <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`} />
              {connected ? "即時連線" : "重新連線中"}
            </div>
            <p className="mt-2 font-semibold text-lg">{statusText[summary.status]}</p>
          </div>
        </header>

        <section className={`${vertical ? "mt-12 space-y-6" : "mt-10 grid lg:grid-cols-[1.7fr_1fr] gap-8"}`}>
          <div className="space-y-5">
            {sortedCandidates.map((candidate, index) => {
              const leader = candidate.candidate_id === summary.leader_candidate_id;
              return (
                <article
                  key={candidate.candidate_id}
                  className={`rounded-3xl border p-6 ${leader ? "border-cyan-300 bg-cyan-300/10" : "border-white/15 bg-white/5"}`}
                >
                  <div className="flex items-center gap-5">
                    <div
                      className="h-14 w-14 rounded-2xl grid place-items-center font-bold text-xl"
                      style={{ background: candidate.color }}
                    >
                      {candidate.number}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          {candidate.members.length > 0 ? candidate.members.map((member) => (
                            <p key={member.id} className="flex flex-wrap items-baseline gap-2">
                              <span className="text-sm text-slate-400">
                                {member.position}
                              </span>
                              <span className={`${vertical ? "text-3xl" : "text-2xl"} font-bold`}>
                                {member.name}
                              </span>
                            </p>
                          )) : (
                            <h2 className={`${vertical ? "text-3xl" : "text-2xl"} font-bold`}>
                              {candidate.name}
                            </h2>
                          )}
                        </div>
                        {leader && index === 0 && (
                          <span className="rounded-full bg-cyan-300 px-3 py-1 text-sm font-bold text-slate-950">
                            領先
                          </span>
                        )}
                      </div>
                      <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${candidate.percentage}%`, background: candidate.color }}
                        />
                      </div>
                    </div>
                    <div className="text-right min-w-32">
                      <p className={`${vertical ? "text-5xl" : "text-4xl"} font-black tabular-nums`}>
                        {candidate.votes}
                      </p>
                      <p className="text-lg text-slate-300">{candidate.percentage.toFixed(1)}%</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <aside className={`${vertical ? "mt-auto pt-12" : ""} space-y-5`}>
            <div className="rounded-3xl bg-white/5 border border-white/15 p-6">
              <p className="text-slate-400">目前開票票匭</p>
              <p className="mt-2 text-2xl font-bold">
                {summary.current_ballot_boxes.join("、") || "無"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-3xl bg-white/5 border border-white/15 p-6">
                <p className="text-slate-400">已開票</p>
                <p className="mt-2 text-3xl font-black tabular-nums">
                  {summary.total_votes}
                  {summary.expected_total_votes !== null && (
                    <span className="text-lg text-slate-400"> / {summary.expected_total_votes}</span>
                  )}
                </p>
              </div>
              <div className="rounded-3xl bg-white/5 border border-white/15 p-6">
                <p className="text-slate-400">廢票</p>
                <p className="mt-2 text-3xl font-black tabular-nums">{summary.invalid_votes}</p>
              </div>
            </div>
            {summary.progress_percentage !== null && (
              <div className="rounded-3xl bg-white/5 border border-white/15 p-6">
                <div className="flex justify-between">
                  <span className="text-slate-400">整體開票率</span>
                  <strong>{summary.progress_percentage.toFixed(1)}%</strong>
                </div>
                <div className="mt-3 h-4 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-cyan-300 transition-all"
                    style={{ width: `${Math.min(summary.progress_percentage, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </aside>
        </section>

        <footer className={`${vertical ? "mt-10" : "mt-8"} flex justify-between text-sm text-slate-400`}>
          <span>資料由開票事件紀錄即時計算</span>
          <span>最後更新 {new Date(summary.last_updated_at).toLocaleTimeString("zh-TW")}</span>
        </footer>
      </div>
    </main>
  );
}
