"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/lib/config";
import { meetingsApi } from "@/lib/api";
import type { MeetingScreenOut } from "@/lib/types";

function wsBase() {
  if (typeof window === "undefined") return "ws://localhost:8000";
  const base = API_BASE || window.location.origin;
  return base.replace(/^http/, "ws").replace(/\/$/, "");
}

export default function MeetingScreenPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [screen, setScreen] = useState<MeetingScreenOut | null>(null);
  const [error, setError] = useState("");
  const readingRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void params.then(({ token: nextToken }) => setToken(nextToken));
  }, [params]);

  useEffect(() => {
    if (!token) return;
    meetingsApi.publicScreen(token).then(setScreen).catch((err) => {
      setError(err instanceof Error ? err.message : "載入大屏失敗");
    });

    const ws = new WebSocket(`${wsBase()}/public/meetings/screen/${encodeURIComponent(token)}/ws`);
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as { data?: MeetingScreenOut };
        if (message.data?.meeting) setScreen(message.data);
      } catch {
        // ignore malformed messages
      }
    };
    return () => ws.close(1000, "screen unmounted");
  }, [token]);

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

  const { meeting, current_agenda_item: current, active_vote: vote, attendance_summary: summary } = screen;
  const activeAttachment = current?.attachments.find(
    (attachment) => attachment.id === screenState?.active_attachment_id,
  );
  const voteRate = vote?.tally?.eligible
    ? Math.round(((vote.tally.total || 0) / vote.tally.eligible) * 100)
    : 0;

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
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border border-white/10 px-5 py-3">
              <p className="text-3xl font-semibold">{summary.present_voters ?? 0}</p>
              <p className="mt-1 text-xs text-white/60">出席表決權</p>
            </div>
            <div className="rounded-lg border border-white/10 px-5 py-3">
              <p className="text-3xl font-semibold">{meeting.quorum_count}</p>
              <p className="mt-1 text-xs text-white/60">開會門檻</p>
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
              {screenState?.reading_mode === "attachment" && activeAttachment ? (
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
                      <p className="text-xs text-white/60">反對</p>
                    </div>
                    <div className="rounded-md bg-white/10 p-3">
                      <p className="text-3xl font-semibold">{vote.tally?.abstain ?? 0}</p>
                      <p className="text-xs text-white/60">棄權</p>
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
          狀態：{meeting.status} · 大屏由控制台遠端更新
        </footer>
      </div>
    </main>
  );
}
