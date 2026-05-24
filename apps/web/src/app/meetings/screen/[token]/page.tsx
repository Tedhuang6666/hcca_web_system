"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wsBase } from "@/lib/config";
import { meetingsApi } from "@/lib/api";
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

export default function MeetingScreenPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [screen, setScreen] = useState<MeetingScreenOut | null>(null);
  const [error, setError] = useState("");
  const readingRef = useRef<HTMLDivElement | null>(null);
  const hasScreenRef = useRef(false);

  useEffect(() => {
    void params.then(({ token: nextToken }) => setToken(nextToken));
  }, [params]);

  useEffect(() => {
    hasScreenRef.current = Boolean(screen);
  }, [screen]);

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

  if (error) return <main className="flex min-h-screen items-center justify-center text-red-500">{error}</main>;
  if (!screen) return <main className="flex min-h-screen items-center justify-center">載入大屏...</main>;

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

  return (
    <main className="min-h-screen bg-[#080b12] text-white">
      <div
        className={`grid min-h-screen grid-rows-[auto_1fr_auto] px-10 py-8 ${
          screenState?.is_fullscreen ? "px-6 py-5" : ""
        }`}>
        <header className="flex items-start justify-between gap-6 border-b border-white/10 pb-6">
          <div>
            <p className="text-sm font-medium text-amber-300">公開議事大屏</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-normal">{meeting.title}</h1>
            <p className="mt-2 text-lg text-white/70">
              {meeting.location || "未填地點"} · 主席 {meeting.chair_name || "未填"}
            </p>
          </div>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div className="rounded-lg border border-white/10 px-5 py-3">
              <p className="text-3xl font-semibold">{summary.present_voters ?? 0}</p>
              <p className="mt-1 text-xs text-white/60">出席表決權</p>
            </div>
            <div className="rounded-lg border border-white/10 px-5 py-3">
              <p className="text-3xl font-semibold">{meeting.quorum_count}</p>
              <p className="mt-1 text-xs text-white/60">開會門檻</p>
            </div>
            <div className="rounded-lg border border-white/10 px-5 py-3">
              <p className="text-3xl font-semibold">{presentRate}%</p>
              <p className="mt-1 text-xs text-white/60">出席率</p>
            </div>
            <div className="rounded-lg border border-white/10 px-5 py-3">
              <p className="text-3xl font-semibold">{agenda.length}</p>
              <p className="mt-1 text-xs text-white/60">議程項目</p>
            </div>
          </div>
        </header>

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
                </p>
              )}
            </div>
            {(meeting.screen_focus_title || meeting.screen_focus_body) && (
              <div className="mt-8 rounded-lg border border-amber-300/30 bg-amber-300/10 p-6">
                <p className="text-sm font-medium text-amber-200">主席提示 / 條文焦點</p>
                <h3 className="mt-2 text-3xl font-semibold tracking-normal">
                  {meeting.screen_focus_title || "焦點內容"}
                </h3>
                {meeting.screen_focus_body && (
                  <p className="mt-4 whitespace-pre-wrap text-2xl leading-relaxed text-white/86">
                    {meeting.screen_focus_body}
                  </p>
                )}
              </div>
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
              </div>
            </section>

            <section className="rounded-lg border border-white/10 p-5">
              <p className="text-sm font-medium text-white/60">現場表決</p>
              {vote ? (
                <>
                  <h3 className="mt-2 text-2xl font-semibold tracking-normal">{vote.title}</h3>
                  <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-amber-300" style={{ width: `${voteRate}%` }} />
                  </div>
                  <p className="mt-2 text-sm text-white/60">
                    投票率 {voteRate}% · {vote.tally?.total ?? 0}/{vote.tally?.eligible ?? 0}
                  </p>
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
                </>
              ) : (
                <p className="mt-3 text-xl text-white/70">尚未開啟表決</p>
              )}
            </section>
          </aside>
        </section>

        <footer className="border-t border-white/10 pt-4 text-sm text-white/50">
          狀態：{STATUS_LABEL[meeting.status] ?? meeting.status} · 大屏由控制台遠端更新
        </footer>
      </div>
    </main>
  );
}
