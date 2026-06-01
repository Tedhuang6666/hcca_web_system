"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wsBase } from "@/lib/config";
import { meetingsApi } from "@/lib/api";
<<<<<<< HEAD
import type { MeetingScreenOut, MeetingSpeechQueueItemOut } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿籌備",
  confirmed: "議程已確認",
  checkin: "開放報到",
  active: "會議進行中",
  break: "休息中",
  paused: "暫停",
  closed: "已結束",
  archived: "已封存",
};

function formatSeconds(value: number) {
  const sign = value < 0 ? "-" : "";
  const safe = Math.abs(value);
  const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
  const seconds = Math.floor(safe % 60).toString().padStart(2, "0");
  return `${sign}${minutes}:${seconds}`;
}

function timerRemaining(item: MeetingSpeechQueueItemOut | null, now: number) {
  if (!item) return 0;
  if (item.status === "speaking" && item.started_at) {
    const elapsed = Math.floor((now - new Date(item.started_at).getTime()) / 1000);
    return item.remaining_seconds - Math.max(0, elapsed);
  }
  return item.remaining_seconds;
}
=======
import type { MeetingScreenOut, MeetingVoteRosterClassOut } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  active: "進行中",
  paused: "暫停",
  closed: "已結束",
};

const ATTENDANCE_LABEL: Record<string, string> = {
  expected: "未報到",
  present: "已出席",
  absent: "缺席",
  leave: "請假",
};

const VOTE_STATUS_LABEL: Record<MeetingVoteRosterClassOut["status"], string> = {
  approve: "同意",
  reject: "不同意",
  abstain: "廢票",
  not_voted: "未投票",
  mixed: "分歧",
};

const VOTE_STATUS_CLASS: Record<MeetingVoteRosterClassOut["status"], string> = {
  approve: "border-green-300/70 bg-green-400 text-black",
  reject: "border-red-300/70 bg-red-500 text-white",
  abstain: "border-zinc-400/80 bg-zinc-500 text-white",
  not_voted: "border-white/30 bg-white text-black",
  mixed: "border-amber-300/80 bg-amber-300 text-black",
};
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71

export default function MeetingScreenPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [screen, setScreen] = useState<MeetingScreenOut | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const readingRef = useRef<HTMLDivElement | null>(null);
  const hasScreenRef = useRef(false);

  useEffect(() => {
    void params.then(({ token: nextToken }) => setToken(nextToken));
  }, [params]);

  useEffect(() => {
    hasScreenRef.current = Boolean(screen);
  }, [screen]);
<<<<<<< HEAD
=======

  const loadScreen = useCallback(async (nextToken = token) => {
    if (!nextToken) return;
    try {
      const next = await meetingsApi.publicScreen(nextToken);
      setScreen(next);
      setError("");
    } catch (err) {
      if (!hasScreenRef.current) setError(err instanceof Error ? err.message : "載入大屏失敗");
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void loadScreen(token);
    const refreshTimer = window.setInterval(() => {
      void loadScreen(token);
    }, 3000);
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadScreen = useCallback(async (nextToken = token) => {
    if (!nextToken) return;
    try {
      setScreen(await meetingsApi.publicScreen(nextToken));
      setError("");
    } catch (err) {
      if (!hasScreenRef.current) setError(err instanceof Error ? err.message : "載入大屏失敗");
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void loadScreen(token);
    const refreshTimer = window.setInterval(() => void loadScreen(token), 3000);
    const ws = new WebSocket(`${wsBase()}/public/meetings/screen/${encodeURIComponent(token)}/ws`);
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as { data?: MeetingScreenOut };
        if (message.data?.meeting) {
          setScreen(message.data);
          setError("");
        }
      } catch {
        // ignore malformed messages
      }
    };
    return () => {
      window.clearInterval(refreshTimer);
      ws.close(1000, "screen unmounted");
    };
  }, [loadScreen, token]);

  const agenda = useMemo(
    () => [...(screen?.meeting.agenda_items ?? [])].sort((a, b) => a.order_index - b.order_index),
    [screen],
  );

  const screenState = screen?.screen_state ?? null;
  const mode = screenState?.reading_mode ?? "agenda";

  useEffect(() => {
    const target = readingRef.current;
    if (!target || !screenState) return;
    target.scrollTo({ top: screenState.scroll_position, behavior: "smooth" });
  }, [screenState?.scroll_position, screenState]);

  useEffect(() => {
    const target = readingRef.current;
    if (!target || !screenState?.auto_scroll) return;
    const timer = window.setInterval(() => {
      target.scrollBy({ top: Math.max(1, screenState.scroll_speed) * 2, behavior: "smooth" });
    }, 250);
    return () => window.clearInterval(timer);
  }, [screenState?.auto_scroll, screenState?.scroll_speed]);

  if (error) {
    return <main className="flex min-h-screen items-center justify-center bg-[#080b12] text-red-300">{error}</main>;
  }
  if (!screen) {
    return <main className="flex min-h-screen items-center justify-center bg-[#080b12] text-white">載入大屏...</main>;
  }

<<<<<<< HEAD
  const { meeting, current_agenda_item: current, active_vote: vote, attendance_summary: summary } = screen;
  const activeSpeech = screen.active_speech;
  const remaining = timerRemaining(activeSpeech, now);
  const notVoted = Math.max(0, (vote?.tally?.eligible ?? 0) - (vote?.tally?.total ?? 0));
  const title = screenState?.title || current?.title || meeting.title;
  const body = screenState?.body || current?.description || "";
  const activeIndex = current ? agenda.findIndex((item) => item.id === current.id) : -1;
=======
  const {
    meeting,
    current_agenda_item: current,
    active_vote: vote,
    attendance_summary: summary,
    vote_roster: voteRoster,
  } = screen;
  const activeAttachment = current?.attachments.find(
    (attachment) => attachment.id === screenState?.active_attachment_id,
  );
  const voteRate = vote?.tally?.eligible
    ? Math.round(((vote.tally.total || 0) / vote.tally.eligible) * 100)
    : 0;
  const attendanceTotal =
    (summary.present ?? 0) + (summary.expected ?? 0) + (summary.absent ?? 0) + (summary.leave ?? 0);
  const presentRate = meeting.expected_voters
    ? Math.round(((summary.present_voters ?? 0) / meeting.expected_voters) * 100)
    : 0;
  const rosterClasses = voteRoster
    ? [...voteRoster.classes, ...(voteRoster.unassigned ? [voteRoster.unassigned] : [])]
    : [];
  const votedCount = (vote?.tally?.approve ?? 0) + (vote?.tally?.reject ?? 0) + (vote?.tally?.abstain ?? 0);
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71

  return (
    <main className="min-h-screen overflow-hidden bg-[#070a10] text-white">
      <div className="grid min-h-screen grid-rows-[auto_1fr_auto] px-12 py-9">
        <header className="flex items-start justify-between gap-8 border-b border-white/10 pb-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-[0.18em] text-amber-300">HCCA PUBLIC DISPLAY</p>
            <h1 className="mt-2 truncate text-4xl font-semibold tracking-normal">{meeting.title}</h1>
            <p className="mt-2 text-lg text-white/62">
              {meeting.location || "未填地點"} · 主席 {meeting.chair_name || "未填"} · {STATUS_LABEL[meeting.status] ?? meeting.status}
            </p>
          </div>
<<<<<<< HEAD
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="min-w-28 rounded-md border border-white/10 px-5 py-3">
=======
          <div className="grid grid-cols-4 gap-3 text-center">
            <div className="rounded-lg border border-white/10 px-5 py-3">
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
              <p className="text-3xl font-semibold">{summary.present_voters ?? 0}</p>
              <p className="mt-1 text-xs text-white/55">出席表決權</p>
            </div>
            <div className="min-w-28 rounded-md border border-white/10 px-5 py-3">
              <p className="text-3xl font-semibold">{meeting.quorum_count}</p>
              <p className="mt-1 text-xs text-white/55">開會門檻</p>
            </div>
<<<<<<< HEAD
            <div className="min-w-28 rounded-md border border-white/10 px-5 py-3">
              <p className="text-3xl font-semibold">{activeIndex >= 0 ? activeIndex + 1 : "-"}</p>
              <p className="mt-1 text-xs text-white/55">目前案次</p>
=======
            <div className="rounded-lg border border-white/10 px-5 py-3">
              <p className="text-3xl font-semibold">{presentRate}%</p>
              <p className="mt-1 text-xs text-white/60">出席率</p>
            </div>
            <div className="rounded-lg border border-white/10 px-5 py-3">
              <p className="text-3xl font-semibold">{agenda.length}</p>
              <p className="mt-1 text-xs text-white/60">議程項目</p>
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
            </div>
          </div>
        </header>

<<<<<<< HEAD
        <section className="grid min-h-0 py-8">
          {mode === "speaker" ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <p className="text-2xl font-medium text-amber-300">目前發言</p>
                <h2 className="mt-6 text-7xl font-semibold tracking-normal">
                  {activeSpeech?.speaker_name || "等待發言"}
                </h2>
                {activeSpeech?.speaker_role && (
                  <p className="mt-4 text-3xl text-white/68">{activeSpeech.speaker_role}</p>
                )}
                <p className={`mt-12 text-[9rem] font-semibold leading-none ${
                  remaining < 0 ? "text-red-400" : remaining <= 30 ? "text-amber-300" : "text-white"
                }`}>
                  {activeSpeech ? formatSeconds(remaining) : "--:--"}
=======
        <section className="grid gap-8 py-8 xl:grid-cols-[1fr_380px]">
          <div className="min-w-0">
            <p className="text-sm font-medium text-amber-300">現在議案</p>
            <h2 className="mt-3 text-5xl font-semibold leading-tight tracking-normal">
              {screenState?.title || current?.title || "等待議程切換"}
            </h2>
            <div
              ref={readingRef}
              className="mt-6 max-h-[58vh] overflow-y-auto pr-3 text-2xl leading-relaxed text-white/82">
              {screenState?.reading_mode === "vote" ? (
                vote ? (
                  <div className="rounded-lg border border-amber-300/30 bg-white/[0.03] p-6">
                    <p className="text-sm font-medium text-amber-200">現場表決</p>
                    <h3 className="mt-2 text-4xl font-semibold tracking-normal">{vote.title}</h3>
                    {vote.description && (
                      <p className="mt-4 whitespace-pre-wrap text-xl text-white/72">
                        {vote.description}
                      </p>
                    )}
                    <div className="mt-8 h-4 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full bg-amber-300" style={{ width: `${voteRate}%` }} />
                    </div>
                    <p className="mt-3 text-lg text-white/70">
                      投票率 {voteRate}% · {vote.tally?.total ?? 0}/{vote.tally?.eligible ?? 0}
                    </p>
                    <div className="mt-8 grid grid-cols-4 gap-4 text-center">
                      <div className="rounded-md bg-green-500/15 p-5">
                        <p className="text-5xl font-semibold">{vote.tally?.approve ?? 0}</p>
                        <p className="mt-2 text-sm text-white/60">同意</p>
                      </div>
                      <div className="rounded-md bg-red-500/15 p-5">
                        <p className="text-5xl font-semibold">{vote.tally?.reject ?? 0}</p>
                        <p className="mt-2 text-sm text-white/60">不同意</p>
                      </div>
                      <div className="rounded-md bg-white/10 p-5">
                        <p className="text-5xl font-semibold">{vote.tally?.abstain ?? 0}</p>
                        <p className="mt-2 text-sm text-white/60">廢票</p>
                      </div>
                      <div className="rounded-md bg-white/10 p-5">
                        <p className="text-5xl font-semibold">
                          {Math.max(0, (vote.tally?.eligible ?? 0) - votedCount)}
                        </p>
                        <p className="mt-2 text-sm text-white/60">未投票</p>
                      </div>
                    </div>
                    {rosterClasses.length > 0 && (
                      <div className="mt-8">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm font-medium text-white/60">各班投票狀態</p>
                          <div className="flex flex-wrap gap-2 text-xs">
                            <span className="rounded-full bg-green-400 px-2 py-1 text-black">綠 同意</span>
                            <span className="rounded-full bg-red-500 px-2 py-1 text-white">紅 不同意</span>
                            <span className="rounded-full bg-zinc-500 px-2 py-1 text-white">灰 廢票</span>
                            <span className="rounded-full bg-white px-2 py-1 text-black">白 未投票</span>
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(86px,1fr))] gap-2">
                          {rosterClasses.map((item) => (
                            <div
                              key={item.class_id ?? item.class_code}
                              className={`min-h-20 rounded-md border px-2 py-2 text-center shadow-lg ${
                                VOTE_STATUS_CLASS[item.status]
                              } ${item.eligible === 0 ? "opacity-45" : ""}`}>
                              <p className="truncate text-lg font-semibold">{item.class_code}</p>
                              <p className="mt-1 text-xs font-medium">
                                {item.eligible === 0 ? "無表決權" : VOTE_STATUS_LABEL[item.status]}
                              </p>
                              {item.eligible > 1 && (
                                <p className="mt-1 text-[11px]">
                                  {item.approve}/{item.reject}/{item.abstain}/{item.not_voted}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">尚未開啟表決</p>
                )
              ) : screenState?.reading_mode === "attachment" && activeAttachment ? (
                <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-6">
                  <p className="text-sm font-medium text-amber-200">附件</p>
                  <h3 className="mt-2 text-3xl font-semibold tracking-normal">
                    {activeAttachment.display_name || activeAttachment.filename}
                  </h3>
                  {activeAttachment.link_url ? (
                    <p className="mt-4 break-all text-xl text-white/80">{activeAttachment.link_url}</p>
                  ) : (
                    <p className="mt-4 text-xl text-white/80">已開啟附件檔案，請由控制端切換顯示。</p>
                  )}
                </div>
              ) : (
                <p className="whitespace-pre-wrap">
                  {screenState?.body || current?.description || "等待主席推送法條或重點內容"}
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
                </p>
                {screen.speech_queue.length > 1 && (
                  <p className="mt-8 text-2xl text-white/58">
                    下一位：{screen.speech_queue.filter((item) => item.id !== activeSpeech?.id)[0]?.speaker_name || "無"}
                  </p>
                )}
              </div>
<<<<<<< HEAD
            </div>
          ) : mode === "vote" || mode === "result" ? (
            <div className="grid h-full content-center gap-8">
              <div>
                <p className="text-2xl font-medium text-amber-300">
                  {mode === "result" ? "表決結果" : "現場表決"}
                </p>
                <h2 className="mt-4 text-6xl font-semibold leading-tight tracking-normal">
                  {vote?.title || title || "尚未開啟表決"}
                </h2>
=======
            )}
          </div>

          <aside className="grid content-start gap-5">
            <section className="rounded-lg border border-white/10 p-5">
              <p className="text-sm font-medium text-white/60">出席狀態</p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                {(["present", "expected", "absent", "leave"] as const).map((key) => (
                  <div key={key} className="rounded-md bg-white/10 p-3">
                    <p className="text-3xl font-semibold">{summary[key] ?? 0}</p>
                    <p className="mt-1 text-xs text-white/60">{ATTENDANCE_LABEL[key]}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-amber-300"
                  style={{ width: `${attendanceTotal ? ((summary.present ?? 0) / attendanceTotal) * 100 : 0}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-white/60">
                出席表決權 {summary.present_voters ?? 0}/{meeting.expected_voters || vote?.tally?.eligible || 0}
              </p>
            </section>

            <section className="rounded-lg border border-white/10 p-5">
              <p className="text-sm font-medium text-white/60">議程</p>
              <div className="mt-4 grid gap-3">
                {agenda.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-md border p-3 ${
                      item.id === current?.id ? "border-amber-300 bg-amber-300/10" : "border-white/10"
                    }`}>
                    <p className="text-sm text-white/50">{item.order_index + 1}</p>
                    <p className="mt-1 text-lg font-medium">{item.title}</p>
                  </div>
                ))}
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
              </div>
              {vote ? (
                <>
                  <div className="grid grid-cols-4 gap-5 text-center">
                    <div className="rounded-md bg-green-500/16 p-7">
                      <p className="text-7xl font-semibold text-green-200">{vote.tally?.approve ?? 0}</p>
                      <p className="mt-3 text-xl text-white/65">同意</p>
                    </div>
                    <div className="rounded-md bg-red-500/16 p-7">
                      <p className="text-7xl font-semibold text-red-200">{vote.tally?.reject ?? 0}</p>
                      <p className="mt-3 text-xl text-white/65">不同意</p>
                    </div>
                    <div className="rounded-md bg-white/10 p-7">
                      <p className="text-7xl font-semibold">{vote.tally?.abstain ?? 0}</p>
                      <p className="mt-3 text-xl text-white/65">棄權</p>
                    </div>
                    <div className="rounded-md bg-white/10 p-7">
                      <p className="text-7xl font-semibold">{notVoted}</p>
                      <p className="mt-3 text-xl text-white/65">未投票</p>
                    </div>
                  </div>
                  <div className="h-5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-amber-300"
                      style={{
                        width: `${vote.tally?.eligible ? ((vote.tally.total || 0) / vote.tally.eligible) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <p className="text-center text-5xl font-semibold">
                    {mode === "result" || vote.status === "closed"
                      ? vote.tally?.passed ? "決議：通過" : "決議：未通過"
                      : `投票進度 ${vote.tally?.total ?? 0}/${vote.tally?.eligible ?? 0}`}
                  </p>
<<<<<<< HEAD
=======
                  <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-green-500/15 p-3">
                      <p className="text-3xl font-semibold">{vote.tally?.approve ?? 0}</p>
                      <p className="text-xs text-white/60">同意</p>
                    </div>
                    <div className="rounded-md bg-red-500/15 p-3">
                      <p className="text-3xl font-semibold">{vote.tally?.reject ?? 0}</p>
                      <p className="text-xs text-white/60">不同意</p>
                    </div>
                    <div className="rounded-md bg-white/10 p-3">
                      <p className="text-3xl font-semibold">{vote.tally?.abstain ?? 0}</p>
                      <p className="text-xs text-white/60">廢票</p>
                    </div>
                  </div>
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
                </>
              ) : (
                <p className="text-4xl text-white/70">等待主席開啟表決</p>
              )}
            </div>
          ) : mode === "break" ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <p className="text-3xl font-medium text-amber-300">會議休息中</p>
                <h2 className="mt-8 text-7xl font-semibold tracking-normal">{title || "休息"}</h2>
                {body && <p className="mt-8 whitespace-pre-wrap text-4xl text-white/72">{body}</p>}
              </div>
            </div>
          ) : mode === "announcement" ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <p className="text-3xl font-medium text-amber-300">公告</p>
                <h2 className="mt-8 text-7xl font-semibold tracking-normal">{title}</h2>
                {body && <p className="mt-8 whitespace-pre-wrap text-4xl leading-relaxed text-white/78">{body}</p>}
              </div>
            </div>
          ) : (
            <div className="grid min-h-0 gap-8 xl:grid-cols-[1fr_340px]">
              <div className="min-w-0">
                <p className="text-2xl font-medium text-amber-300">
                  {mode === "document" || mode === "article" || mode === "attachment" ? "議程資料" : "目前議案"}
                </p>
                <h2 className="mt-4 text-6xl font-semibold leading-tight tracking-normal">{title}</h2>
                <div
                  ref={readingRef}
                  className="mt-8 max-h-[52vh] overflow-y-auto pr-4 text-3xl leading-relaxed text-white/78">
                  <p className="whitespace-pre-wrap">{body || "等待主席推送議程內容"}</p>
                </div>
              </div>
              <aside className="grid content-start gap-3">
                <p className="text-sm font-medium text-white/50">議程</p>
                {agenda.slice(Math.max(0, activeIndex - 1), activeIndex + 4).map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-md border p-4 ${
                      item.id === current?.id ? "border-amber-300 bg-amber-300/10" : "border-white/10"
                    }`}>
                    <p className="text-sm text-white/45">第 {item.order_index + 1} 案</p>
                    <p className="mt-1 text-xl font-medium">{item.title}</p>
                  </div>
                ))}
              </aside>
            </div>
          )}
        </section>

<<<<<<< HEAD
        <footer className="flex items-center justify-between border-t border-white/10 pt-4 text-sm text-white/48">
          <span>{new Date(now).toLocaleString("zh-TW")}</span>
          <span>大屏由議場控制台即時同步</span>
=======
        <footer className="border-t border-white/10 pt-4 text-sm text-white/50">
          狀態：{STATUS_LABEL[meeting.status] ?? meeting.status} · 大屏由控制台遠端更新
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
        </footer>
      </div>
    </main>
  );
}
