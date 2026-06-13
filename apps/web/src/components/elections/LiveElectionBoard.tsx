"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleAlert,
  Crown,
  Link2,
  PauseCircle,
  Radio,
  RefreshCw,
  Trophy,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import BrandEmblem from "@/components/brand/BrandEmblem";
import { useCountUp } from "@/hooks/useCountUp";
import { electionsApi } from "@/lib/api";
import { uploadUrl, wsBase } from "@/lib/config";
import type { CandidateTally, ElectionLiveSummary } from "@/lib/types";

const statusInfo = {
  draft: { label: "尚未開始", icon: CircleAlert, tone: "text-slate-300 bg-white/8" },
  live: { label: "開票進行中", icon: Radio, tone: "text-emerald-300 bg-emerald-400/10" },
  paused: { label: "暫停開票", icon: PauseCircle, tone: "text-amber-300 bg-amber-400/10" },
  closed: { label: "開票完成", icon: CheckCircle2, tone: "text-sky-300 bg-sky-400/10" },
};

const CONFETTI_COLORS = ["#e8c970", "#f8f3e5", "#6ee7b7", "#7cc4ff", "#f2a6c2", "#c9a84c"];

function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const display = useCountUp(value);
  return <span className={className}>{display.toLocaleString("zh-TW")}</span>;
}

function MemberAvatars({ candidate, size = 44 }: { candidate: CandidateTally; size?: number }) {
  const withPhotos = candidate.members
    .map((member) => ({ ...member, photoSrc: uploadUrl(member.photo_url) }))
    .filter((member) => member.photoSrc);
  if (withPhotos.length === 0) return null;
  return (
    <div className="flex shrink-0 -space-x-3">
      {withPhotos.map((member) => (
        <Image
          key={member.id}
          src={member.photoSrc}
          alt={member.name}
          width={size}
          height={size}
          unoptimized
          className="rounded-full object-cover ring-2 ring-[#173654]"
          style={{ width: size, height: size, background: "#0d1f31" }}
        />
      ))}
    </div>
  );
}

export default function LiveElectionBoard({
  electionId,
  vertical = false,
}: {
  electionId: string;
  vertical?: boolean;
}) {
  const [summary, setSummary] = useState<ElectionLiveSummary | null>(null);
  const [connected, setConnected] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    electionsApi.live(electionId).then(setSummary).catch(() => undefined);
  }, [electionId]);

  // 初次載入 + 輪詢備援（slug 或 UUID 皆可）
  useEffect(() => {
    load();
    const fallback = window.setInterval(load, 15_000);
    return () => window.clearInterval(fallback);
  }, [load]);

  // WebSocket 房間以真實 UUID 為鍵，待解析出 election_id 後才連線
  const resolvedId = summary?.election_id ?? null;
  useEffect(() => {
    if (!resolvedId) return;
    const socket = new WebSocket(`${wsBase()}/ws/public/elections/${encodeURIComponent(resolvedId)}`);
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as { type: string; data?: ElectionLiveSummary };
        if (message.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }));
        } else if (message.type === "election_update" && message.data) {
          setSummary(message.data);
        }
      } catch {
        // 忽略損毀的訊框，保留最後一次有效資料
      }
    };
    return () => socket.close();
  }, [resolvedId]);

  const sortedCandidates = useMemo(
    () => (summary ? [...summary.candidates].sort((a, b) => b.votes - a.votes) : []),
    [summary],
  );

  // 加票閃光 + 超前偵測
  const prevVotes = useRef<Record<string, number>>({});
  const prevRank = useRef<Record<string, number>>({});
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [surgeIds, setSurgeIds] = useState<Set<string>>(new Set());
  // 每位候選人最近一次加票：key 用於重播動畫、count 決定飄入的選票張數
  const [flyIns, setFlyIns] = useState<Record<string, { key: number; count: number; gain: number }>>({});
  // 飄票排程計時器存在 ref，不隨每次開票更新被取消（否則清除排程被砍 → 殘留節點重播）
  const flyTimers = useRef<number[]>([]);
  useEffect(() => () => flyTimers.current.forEach((t) => window.clearTimeout(t)), []);

  useEffect(() => {
    if (sortedCandidates.length === 0) return;
    const flash = new Set<string>();
    const surge = new Set<string>();
    type Fly = { key: number; count: number; gain: number };
    const flyNow: Record<string, Fly> = {};
    const flyAfterMove: Record<string, Fly> = {};
    sortedCandidates.forEach((candidate, index) => {
      const pv = prevVotes.current[candidate.candidate_id];
      const pr = prevRank.current[candidate.candidate_id];
      if (pv !== undefined && candidate.votes > pv) {
        flash.add(candidate.candidate_id);
        const gain = candidate.votes - pv;
        const entry: Fly = { key: performance.now() + index, count: Math.min(gain, 6), gain };
        // 若同時換位，等候列滑動完再播選票，避免動畫橫跨新舊兩個位置
        if (pr !== undefined && pr !== index) flyAfterMove[candidate.candidate_id] = entry;
        else flyNow[candidate.candidate_id] = entry;
      }
      if (pr !== undefined && index < pr) surge.add(candidate.candidate_id);
      prevVotes.current[candidate.candidate_id] = candidate.votes;
      prevRank.current[candidate.candidate_id] = index;
    });
    const timers: number[] = [];
    if (flash.size) {
      setFlashIds(flash);
      timers.push(window.setTimeout(() => setFlashIds(new Set()), 900));
    }
    if (surge.size) {
      setSurgeIds(surge);
      timers.push(window.setTimeout(() => setSurgeIds(new Set()), 1300));
    }
    // 動畫播畢後務必把該筆移除：否則殘留的已完成動畫節點會在候選列換位（DOM 搬移）
    // 時被瀏覽器重新觸發，導致「另一位候選人」重播上一次的加票動畫。FLY_LIFE 需長於最長動畫。
    const FLY_LIFE = 2100;
    const persist = (fn: () => void, ms: number) => {
      const t = window.setTimeout(() => {
        flyTimers.current = flyTimers.current.filter((id) => id !== t);
        fn();
      }, ms);
      flyTimers.current.push(t);
    };
    const cleanup = (batch: Record<string, Fly>) =>
      setFlyIns((prev) => {
        const next = { ...prev };
        for (const cid of Object.keys(batch)) {
          if (next[cid]?.key === batch[cid].key) delete next[cid];
        }
        return next;
      });
    if (Object.keys(flyNow).length) {
      setFlyIns((prev) => ({ ...prev, ...flyNow }));
      persist(() => cleanup(flyNow), FLY_LIFE);
    }
    if (Object.keys(flyAfterMove).length) {
      persist(() => setFlyIns((prev) => ({ ...prev, ...flyAfterMove })), 680);
      persist(() => cleanup(flyAfterMove), 680 + FLY_LIFE);
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [sortedCandidates]);

  // FLIP：候選列換位時平滑滑動
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const rowPos = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    rowRefs.current.forEach((el, id) => {
      const top = el.getBoundingClientRect().top;
      next.set(id, top);
      const prev = rowPos.current.get(id);
      if (prev !== undefined && Math.abs(prev - top) > 1) {
        const dy = prev - top;
        el.style.transition = "none";
        el.style.transform = `translateY(${dy}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "";
          el.style.transform = "";
        });
      }
    });
    rowPos.current = next;
  }, [sortedCandidates]);

  const isClosed = summary?.status === "closed";
  const confetti = useMemo(() => {
    if (!isClosed) return [] as { id: number; left: number; color: string; delay: number; dur: number }[];
    return Array.from({ length: vertical ? 70 : 110 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 2.5,
      dur: 2.8 + Math.random() * 2.2,
    }));
  }, [isClosed, vertical]);

  async function copyLink() {
    if (typeof window === "undefined") return;
    const ref = summary?.slug ?? electionId;
    const url = `${window.location.origin}/live/elections/${encodeURIComponent(ref)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 略過：部分瀏覽器需 HTTPS 才能使用剪貼簿
    }
  }

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

  const state = statusInfo[summary.status];
  const StatusIcon = state.icon;
  const totalBallotBoxes = summary.ballot_boxes.length;
  const completedBallotBoxes = summary.ballot_boxes.filter((box) => box.status === "locked").length;
  const electedCandidates = isClosed ? sortedCandidates.filter((c) => c.is_elected) : [];
  const champion = electedCandidates[0] ?? null;
  const runnerUp = champion ? sortedCandidates.find((c) => c.candidate_id !== champion.candidate_id) ?? null : null;
  const championMargin = champion && runnerUp ? champion.votes - runnerUp.votes : null;

  return (
    <main
      className={`live-board relative min-h-screen bg-[#0d1f31] text-[#f8f3e5] ${
        vertical ? "mx-auto w-full max-w-[1080px]" : ""
      }`}
    >
      {confetti.length > 0 && (
        <div className="live-confetti" aria-hidden>
          {confetti.map((piece) => (
            <i
              key={piece.id}
              style={
                {
                  left: `${piece.left}%`,
                  background: piece.color,
                  "--delay": `${piece.delay}s`,
                  "--dur": `${piece.dur}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}

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
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/15 px-3 text-sm font-medium text-[#cdd8e0] transition-colors hover:bg-white/8 hover:text-white"
            >
              {copied ? <Check size={16} className="text-emerald-300" aria-hidden /> : <Link2 size={16} aria-hidden />}
              {copied ? "已複製連結" : "複製分享連結"}
            </button>
            <div className="hidden items-center gap-2 text-xs text-[#91a5b5] sm:flex">
              <BrandEmblem size={30} priority />
              <span>HCCA 即時開票</span>
            </div>
          </div>
        </nav>

        <header
          className={`rounded-2xl border p-5 shadow-2xl shadow-black/20 sm:p-7 lg:p-8 ${
            isClosed ? "border-[#e8c970]/50 bg-gradient-to-br from-[#1c3e5e] to-[#173654]" : "border-white/10 bg-[#173654]"
          }`}
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#e8c970]">
                {isClosed ? "Final Result" : "HCCA Election Live"}
              </p>
              <h1 className={`${vertical ? "text-5xl" : "text-3xl sm:text-4xl lg:text-5xl"} mt-3 font-semibold leading-tight`}>
                {summary.title}
              </h1>
              <p className="mt-3 text-sm leading-6 text-[#aebeca]">
                {isClosed ? "開票作業已完成，以下為最終結果。" : "票數由現場開票事件即時計算，頁面會自動更新。"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              <span className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold ${state.tone}`}>
                <StatusIcon size={16} aria-hidden />
                {state.label}
              </span>
              {!isClosed && (
                <span className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/8 px-4 text-sm text-[#cdd8e0]">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`}
                    aria-hidden
                  />
                  {connected ? "即時連線" : "重新連線中"}
                </span>
              )}
            </div>
          </div>
          {summary.progress_percentage !== null && !isClosed && (
            <div className="mt-7">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-[#aebeca]">整體開票率</span>
                <strong className="text-lg tabular-nums text-[#e8c970]">
                  {summary.progress_percentage.toFixed(1)}%
                </strong>
              </div>
              <div className="live-bar-sheen mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#e8c970] transition-[width] duration-700"
                  style={{ width: `${Math.min(summary.progress_percentage, 100)}%` }}
                />
              </div>
            </div>
          )}
        </header>

        {/* 結算當選名單（單人聚焦 / 多人並列） */}
        {electedCandidates.length > 0 && (
          <section className="live-result-enter mt-5">
            <div className="mb-3 flex items-center gap-2">
              <Trophy className="text-[#e8c970]" size={22} aria-hidden />
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#e8c970]">
                當選名單{summary.seats > 1 ? `（共 ${electedCandidates.length} 名）` : ""}
              </p>
            </div>
            <div
              className={`grid gap-3 ${
                electedCandidates.length === 1
                  ? ""
                  : electedCandidates.length === 2
                    ? "sm:grid-cols-2"
                    : "sm:grid-cols-2 lg:grid-cols-3"
              }`}
            >
              {electedCandidates.map((winner, i) => {
                const single = electedCandidates.length === 1;
                return (
                  <article
                    key={winner.candidate_id}
                    className="live-winner-pop overflow-hidden rounded-2xl border border-[#e8c970]/45 bg-gradient-to-br from-[#e8c970]/[0.14] to-transparent p-5 sm:p-6"
                    style={{ animationDelay: `${i * 120}ms` }}
                  >
                    <div className={`flex items-center gap-4 ${single ? "flex-col text-center sm:flex-row sm:text-left" : ""}`}>
                      <div className="relative grid shrink-0 place-items-center">
                        {single && <Trophy className="absolute -top-7 text-[#e8c970]" size={32} aria-hidden />}
                        <div
                          className={`grid place-items-center rounded-2xl font-black text-white shadow-xl ${
                            single ? "h-24 w-24 text-3xl sm:h-28 sm:w-28" : "h-16 w-16 text-2xl"
                          }`}
                          style={{ backgroundColor: winner.color }}
                        >
                          {winner.number}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {!single && (
                            <span className="rounded-full bg-[#e8c970] px-2 py-0.5 text-[11px] font-bold text-[#173654]">
                              第 {winner.rank} 名
                            </span>
                          )}
                          <MemberAvatars candidate={winner} size={single ? 48 : 38} />
                        </div>
                        <div className="mt-1.5">
                          {winner.members.length > 0 ? (
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                              {winner.members.map((member) => (
                                <span key={member.id} className={`font-semibold ${single ? "text-2xl sm:text-3xl" : "text-xl"}`}>
                                  {member.name}
                                  <span className="ml-1 text-xs font-normal text-[#aebeca]">{member.position}</span>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <h3 className={`font-semibold ${single ? "text-2xl sm:text-3xl" : "text-xl"}`}>{winner.name}</h3>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
                          <p>
                            <AnimatedNumber value={winner.votes} className={`font-black tabular-nums text-[#e8c970] ${single ? "text-4xl sm:text-5xl" : "text-3xl"}`} />
                            <span className="ml-1.5 text-sm text-[#aebeca]">票</span>
                          </p>
                          <p className="text-base tabular-nums text-[#cdd8e0]">得票率 {winner.percentage.toFixed(1)}%</p>
                          {i === 0 && championMargin !== null && (
                            <p className="text-xs tabular-nums text-[#91a5b5]">領先次高 {championMargin.toLocaleString("zh-TW")} 票</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {isClosed && electedCandidates.length === 0 && (
          <section className="live-result-enter mt-5 rounded-2xl border border-rose-400/40 bg-rose-400/10 p-6 text-center sm:p-7">
            <p className="text-lg font-semibold text-rose-100">本次未產生當選者</p>
            <p className="mt-2 text-sm text-rose-200/80">
              {summary.turnout_threshold_pct !== null && !summary.turnout_met
                ? `總投票率 ${summary.turnout_pct ?? 0}% 未達門檻 ${summary.turnout_threshold_pct}%，依規則不計算當選。`
                : "沒有候選人達到得票率門檻。"}
            </p>
          </section>
        )}

        <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "已開票", value: summary.total_votes },
            { label: "有效票", value: summary.valid_votes },
            { label: "廢票", value: summary.invalid_votes },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.045] p-4 sm:p-5">
              <p className="text-xs text-[#91a5b5]">{item.label}</p>
              <AnimatedNumber value={item.value} className="mt-2 block text-2xl font-semibold tabular-nums sm:text-3xl" />
            </div>
          ))}
          <div className="rounded-xl border border-white/10 bg-white/[0.045] p-4 sm:p-5">
            <p className="text-xs text-[#91a5b5]">完成票匭</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums sm:text-3xl">{completedBallotBoxes} / {totalBallotBoxes}</p>
          </div>
        </section>

        {(summary.seats > 1 ||
          summary.vote_threshold_pct !== null ||
          summary.turnout_threshold_pct !== null ||
          summary.turnout_pct !== null) && (
          <section className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.045] px-3 py-1.5 text-[#cdd8e0]">
              應選名額 <strong className="text-[#e8c970]">{summary.seats}</strong> 名
            </span>
            {summary.turnout_pct !== null && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${
                  summary.turnout_met
                    ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-200"
                    : "border-rose-400/35 bg-rose-400/10 text-rose-200"
                }`}
              >
                投票率 <strong>{summary.turnout_pct}%</strong>
                {summary.turnout_threshold_pct !== null && (
                  <span className="opacity-80">
                    / 門檻 {summary.turnout_threshold_pct}% {summary.turnout_met ? "已達" : "未達"}
                  </span>
                )}
              </span>
            )}
            {summary.vote_threshold_pct !== null && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.045] px-3 py-1.5 text-[#cdd8e0]">
                得票率門檻 <strong className="text-[#e8c970]">{summary.vote_threshold_pct}%</strong>
                {summary.threshold_votes !== null && summary.threshold_votes > 0 && (
                  <span className="text-[#91a5b5]">（需 {summary.threshold_votes.toLocaleString("zh-TW")} 票）</span>
                )}
              </span>
            )}
          </section>
        )}

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
                <p className="text-xs font-semibold tracking-[0.16em] text-[#e8c970]">{isClosed ? "FINAL STANDINGS" : "RESULTS"}</p>
                <h2 className="mt-1 text-xl font-semibold">{isClosed ? "最終名次" : "候選人得票"}</h2>
              </div>
              <p className="text-xs text-[#91a5b5]">依目前票數排序</p>
            </div>
            {sortedCandidates.map((candidate, index) => {
              const leader = candidate.candidate_id === summary.leader_candidate_id;
              const barWidth = summary.valid_votes > 0 ? candidate.percentage : 0;
              const flashing = flashIds.has(candidate.candidate_id);
              const surging = surgeIds.has(candidate.candidate_id);
              const fly = flyIns[candidate.candidate_id];
              const medal = index === 0 ? "#e8c970" : index === 1 ? "#cbd5e1" : index === 2 ? "#d8a06a" : null;
              return (
                <article
                  key={candidate.candidate_id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(candidate.candidate_id, el);
                    else rowRefs.current.delete(candidate.candidate_id);
                  }}
                  className={`live-candidate-row relative rounded-2xl border p-4 sm:p-5 ${flashing ? "live-row-flash" : ""} ${
                    (leader && !isClosed) || (isClosed && index === 0)
                      ? "live-leader-glow border-[#e8c970]/60 bg-[#e8c970]/[0.08]"
                      : "border-white/10 bg-white/[0.045]"
                  }`}
                >
                  {fly && (
                    <div className="live-fly-layer" aria-hidden>
                      {Array.from({ length: fly.count }).map((_, k) => (
                        <span
                          key={`${fly.key}-${k}`}
                          className="live-ballot"
                          style={{ "--i": k } as React.CSSProperties}
                        />
                      ))}
                      <span key={`gain-${fly.key}`} className="live-vote-gain">
                        +{fly.gain.toLocaleString("zh-TW")}
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto]">
                    {isClosed && (
                      <div
                        className="grid h-9 w-9 place-items-center rounded-full text-sm font-black"
                        style={{
                          background: medal ?? "rgba(255,255,255,0.08)",
                          color: medal ? "#173654" : "#cdd8e0",
                        }}
                        aria-label={`第 ${index + 1} 名`}
                      >
                        {index + 1}
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <div
                        className="grid h-12 w-12 place-items-center rounded-xl text-lg font-bold text-white shadow-lg sm:h-14 sm:w-14"
                        style={{ backgroundColor: candidate.color }}
                        aria-label={`${candidate.number} 號`}
                      >
                        {candidate.number}
                      </div>
                      <MemberAvatars candidate={candidate} size={vertical ? 52 : 44} />
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
                        {candidate.is_elected && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#e8c970] px-2.5 py-1 text-[11px] font-bold text-[#173654]">
                            <Crown size={12} aria-hidden /> {isClosed ? "當選" : "暫居當選"}
                          </span>
                        )}
                        {!candidate.is_elected && leader && index === 0 && !isClosed && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#e8c970] px-2.5 py-1 text-[11px] font-bold text-[#173654]">
                            <Crown size={12} aria-hidden /> 目前領先
                          </span>
                        )}
                        {summary.vote_threshold_pct !== null &&
                          candidate.votes > 0 &&
                          !candidate.meets_threshold && (
                            <span className="inline-flex items-center rounded-full border border-rose-400/40 bg-rose-400/10 px-2.5 py-1 text-[11px] font-bold text-rose-200">
                              未達門檻
                            </span>
                          )}
                        {surging && summary.status !== "closed" && (
                          <span className="live-overtake-badge inline-flex items-center rounded-full bg-emerald-400/90 px-2.5 py-1 text-[11px] font-bold text-[#062b1c]">
                            ↑ 超前
                          </span>
                        )}
                      </div>
                      <div className="live-bar-sheen mt-3 h-2.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full transition-[width] duration-700"
                          style={{ width: `${barWidth}%`, backgroundColor: candidate.color }}
                        />
                      </div>
                    </div>
                    <div className="col-span-2 flex items-baseline justify-end gap-2 sm:col-span-1 sm:block sm:min-w-32 sm:text-right">
                      <AnimatedNumber
                        value={candidate.votes}
                        className={`${vertical ? "text-5xl" : "text-3xl sm:text-4xl"} font-semibold tabular-nums`}
                      />
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
                          className="h-full rounded-full bg-[#e8c970] transition-[width] duration-700"
                          style={{ width: `${Math.min(box.progress_percentage, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {!isClosed && (
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
            )}
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
