"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CheckCircle2,
  Clock,
  ExternalLink,
  Gavel,
  ListChecks,
  Megaphone,
  Mic,
  Monitor,
  Pause,
  Play,
  Plus,
  Square,
  TimerReset,
  Vote,
} from "lucide-react";
import { meetingsApi } from "@/lib/api";
import { useWS } from "@/hooks/useWS";
import SimpleMeetingConsole from "@/components/meetings/SimpleMeetingConsole";
import type {
  MeetingAgendaItemOut,
  MeetingOut,
  MeetingRequestOut,
  MeetingScreenOut,
  MeetingScreenReadingMode,
  MeetingSpeechQueueItemOut,
  VoteThresholdType,
} from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  confirmed: "議程已確認",
  checkin: "開放報到",
  active: "進行中",
  break: "休息中",
  paused: "暫停",
  closed: "已結束",
  archived: "已封存",
};

const SCENES: { mode: MeetingScreenReadingMode; label: string; icon: typeof ListChecks }[] = [
  { mode: "agenda", label: "議程", icon: ListChecks },
  { mode: "speaker", label: "發言", icon: Mic },
  { mode: "vote", label: "表決", icon: Vote },
  { mode: "result", label: "結果", icon: CheckCircle2 },
  { mode: "break", label: "休息", icon: Clock },
  { mode: "announcement", label: "公告", icon: Megaphone },
  { mode: "document", label: "文件", icon: Gavel },
];

const THRESHOLD_LABEL: Record<VoteThresholdType, string> = {
  simple_majority: "同意多於不同意",
  present_majority: "出席表決權過半",
  all_members_majority: "全體表決權過半",
  custom: "自訂票數",
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

export default function MeetingControlPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [meeting, setMeeting] = useState<MeetingOut | null>(null);
  const [screen, setScreen] = useState<MeetingScreenOut | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState("主席提示");
  const [announcementBody, setAnnouncementBody] = useState("");
  const [voteTitle, setVoteTitle] = useState("");
  const [thresholdType, setThresholdType] = useState<VoteThresholdType>("simple_majority");
  const [customThreshold, setCustomThreshold] = useState(0);
  const [speakerName, setSpeakerName] = useState("");
  const [screenAgendaId, setScreenAgendaId] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void params.then(({ id: nextId }) => setId(nextId));
  }, [params]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async (nextId = id) => {
    if (!nextId) return;
    try {
      const [meetingPayload, screenPayload] = await Promise.all([
        meetingsApi.get(nextId),
        meetingsApi.screen(nextId),
      ]);
      setMeeting(meetingPayload);
      setScreen(screenPayload);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入議場控制台失敗");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useWS(
    id ? `meeting:${id}` : null,
    (msg) => {
      const data = msg.data as MeetingScreenOut | undefined;
      if (data?.meeting) {
        setMeeting(data.meeting);
        setScreen(data);
      }
    },
    Boolean(id),
  );

  async function run<T>(action: () => Promise<T>, success = "操作完成") {
    setBusy(true);
    setNotice("處理中...");
    try {
      const result = await action();
      await load();
      setNotice(success);
      setError("");
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失敗");
      setNotice("");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const agenda = useMemo(
    () => [...(meeting?.agenda_items ?? [])].sort((a, b) => a.order_index - b.order_index),
    [meeting],
  );
  const current = useMemo(
    () => agenda.find((item) => item.id === meeting?.current_agenda_item_id) ?? null,
    [agenda, meeting?.current_agenda_item_id],
  );
  const activeVote = meeting?.votes.find((vote) => vote.status === "open") ?? null;
  const activeSpeech = screen?.active_speech ?? null;
  const speechQueue = screen?.speech_queue ?? meeting?.speech_queue ?? [];
  const pendingRequests = meeting?.requests.filter((item) => item.status === "pending") ?? [];
  const remaining = timerRemaining(activeSpeech, now);

  const screenTarget = useMemo(
    () => agenda.find((item) => item.id === screenAgendaId) ?? current,
    [agenda, screenAgendaId, current],
  );

  async function pushScene(mode: MeetingScreenReadingMode, item?: MeetingAgendaItemOut | null) {
    if (!meeting) return;
    const target = item ?? screenTarget ?? current;
    const scenePayload = {
      agenda_item_id: target?.id ?? meeting.current_agenda_item_id,
      reading_mode: mode,
      title:
        mode === "announcement"
          ? announcementTitle
          : mode === "speaker"
            ? activeSpeech?.speaker_name ?? "等待發言"
            : mode === "vote"
              ? activeVote?.title ?? "現場表決"
              : mode === "break"
                ? "會議休息中"
                : target?.title ?? meeting.title,
      body:
        mode === "announcement"
          ? announcementBody
          : mode === "speaker"
            ? activeSpeech?.speaker_role ?? ""
            : mode === "vote"
              ? activeVote?.description ?? ""
              : mode === "break"
                ? announcementBody
                : target?.description ?? null,
      scroll_position: 0,
      auto_scroll: false,
    };
    await run(() => meetingsApi.updateScreenState(meeting.id, scenePayload), "大屏已切換");
  }

  if (error && !meeting) return <main className="p-6 text-sm text-red-500">{error}</main>;
  if (!meeting) return <main className="p-6 text-sm text-[var(--muted)]">載入議場控制台...</main>;

  // 簡易評議模式走輕量控制台（逐案討論＋表決＋自動會議紀錄）
  if (meeting.mode === "simple") return <SimpleMeetingConsole meetingId={meeting.id} />;

  return (
    <main className="grid min-h-screen gap-4 px-4 py-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
      <aside className="grid content-start gap-4">
        <section className="rounded-lg border border-[var(--border)] p-4">
          <p className="text-xs font-medium text-[var(--muted)]">議場控制台</p>
          <h1 className="mt-1 text-xl font-semibold tracking-normal">{meeting.title}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {STATUS_LABEL[meeting.status] ?? meeting.status}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link
              href={`/meetings/screen/${meeting.screen_token}`}
              target="_blank"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <Monitor size={15} aria-hidden="true" />
              大屏
            </Link>
            <Link
              href={`/meetings/join/${meeting.checkin_token}`}
              target="_blank"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <ExternalLink size={15} aria-hidden="true" />
              議員入口
            </Link>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="mb-3 text-base font-semibold">議程</h2>
          <div className="grid gap-2">
            {agenda.map((item) => (
              <button
                key={item.id}
                onClick={() =>
                  run(async () => {
                    await meetingsApi.update(meeting.id, { current_agenda_item_id: item.id });
                    await meetingsApi.updateScreenState(meeting.id, {
                      agenda_item_id: item.id,
                      reading_mode: "agenda",
                      title: item.title,
                      body: item.description,
                    });
                  }, "已切換議程")
                }
                className={`rounded-md border px-3 py-2 text-left text-sm ${
                  item.id === current?.id
                    ? "border-[var(--primary)] bg-[var(--primary-dim)]"
                    : "border-[var(--border)]"
                }`}>
                <span className="block text-xs text-[var(--muted)]">第 {item.order_index + 1} 案</span>
                <span className="font-medium">{item.title}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section className="grid content-start gap-4">
        {error && <p className="rounded-md border border-red-500/40 p-3 text-sm text-red-500">{error}</p>}
        {notice && <p className="rounded-md border border-emerald-500/40 p-3 text-sm text-emerald-500">{notice}</p>}

        <section className="rounded-lg border border-[var(--border)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-[var(--muted)]">會議流程</p>
              <h2 className="mt-1 text-lg font-semibold">{STATUS_LABEL[meeting.status]}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => run(() => meetingsApi.openCheckIn(meeting.id), "已開放報到")} className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                <CheckCircle2 size={15} aria-hidden="true" /> 報到
              </button>
              <button disabled={busy} onClick={() => run(() => meetingsApi.start(meeting.id), "會議進行中")} className="inline-flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white">
                <Play size={15} aria-hidden="true" /> 開始/恢復
              </button>
              <button disabled={busy} onClick={() => run(() => meetingsApi.break(meeting.id), "已進入休息")} className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                <Clock size={15} aria-hidden="true" /> 休息
              </button>
              <button disabled={busy} onClick={() => run(() => meetingsApi.pause(meeting.id), "已暫停")} className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                <Pause size={15} aria-hidden="true" /> 暫停
              </button>
              <button
                disabled={busy}
                onClick={() => confirm("確定結束會議？") && void run(() => meetingsApi.close(meeting.id), "會議已結束")}
                className="inline-flex items-center gap-2 rounded-md border border-red-500 px-3 py-2 text-sm text-red-500">
                <Square size={15} aria-hidden="true" /> 結束
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-[var(--muted)]">大屏場景</p>
              <h2 className="mt-1 text-lg font-semibold">
                {screen?.screen_state?.title || current?.title || "尚未推送"}
              </h2>
            </div>
            <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
              {screen?.screen_state?.reading_mode ?? "未設定"}
            </span>
          </div>
          <label className="mb-3 flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-2">
            <span className="shrink-0 text-xs font-medium text-[var(--muted)]">推送議程</span>
            <select
              value={screenAgendaId}
              onChange={(event) => setScreenAgendaId(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm">
              <option value="">跟隨目前議程{current ? `（第 ${current.order_index + 1} 案）` : ""}</option>
              {agenda.map((item) => (
                <option key={item.id} value={item.id}>
                  第 {item.order_index + 1} 案 · {item.title}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
            {SCENES.map(({ mode, label, icon: Icon }) => (
              <button
                key={mode}
                disabled={busy}
                onClick={() => pushScene(mode)}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                <Icon size={15} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-[220px_1fr_auto]">
            <input
              value={announcementTitle}
              onChange={(event) => setAnnouncementTitle(event.target.value)}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
              placeholder="公告標題"
            />
            <input
              value={announcementBody}
              onChange={(event) => setAnnouncementBody(event.target.value)}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
              placeholder="公告內容 / 休息恢復時間"
            />
            <button
              disabled={busy}
              onClick={() => pushScene("announcement")}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-black">
              <Bell size={15} aria-hidden="true" />
              推送公告
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-[var(--muted)]">目前發言</p>
              <h2 className="mt-1 text-2xl font-semibold">
                {activeSpeech?.speaker_name || "尚未開始發言"}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{activeSpeech?.speaker_role || " "}</p>
            </div>
            <div className={`text-5xl font-semibold ${remaining < 0 ? "text-red-500" : remaining <= 30 ? "text-amber-500" : ""}`}>
              {activeSpeech ? formatSeconds(remaining) : "--:--"}
            </div>
          </div>
          {activeSpeech && (
            <div className="mt-4 flex flex-wrap gap-2">
              {activeSpeech.status === "speaking" ? (
                <button onClick={() => run(() => meetingsApi.pauseSpeech(meeting.id, activeSpeech.id), "發言已暫停")} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                  暫停
                </button>
              ) : (
                <button onClick={() => run(() => meetingsApi.resumeSpeech(meeting.id, activeSpeech.id), "發言繼續")} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                  繼續
                </button>
              )}
              <button onClick={() => run(() => meetingsApi.extendSpeech(meeting.id, activeSpeech.id, 30), "已延長 30 秒")} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">+30 秒</button>
              <button onClick={() => run(() => meetingsApi.extendSpeech(meeting.id, activeSpeech.id, 60), "已延長 1 分鐘")} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">+1 分鐘</button>
              <button onClick={() => run(() => meetingsApi.finishSpeech(meeting.id, activeSpeech.id), "發言已結束")} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">結束發言</button>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="mb-3 text-base font-semibold">表決控制</h2>
          {activeVote && (
            <div className="mb-4 rounded-md border border-emerald-500/40 p-3">
              <p className="font-medium">{activeVote.title}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                同意 {activeVote.tally?.approve ?? 0}、不同意 {activeVote.tally?.reject ?? 0}、
                棄權 {activeVote.tally?.abstain ?? 0}，投票 {activeVote.tally?.total ?? 0}/{activeVote.tally?.eligible ?? 0}
              </p>
              <button onClick={() => run(() => meetingsApi.closeVote(meeting.id, activeVote.id), "表決已關閉")} className="mt-3 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                關閉表決
              </button>
            </div>
          )}
          <div className="grid gap-2 md:grid-cols-[1fr_180px_120px_auto]">
            <input value={voteTitle} onChange={(event) => setVoteTitle(event.target.value)} placeholder="表決案標題" className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm" />
            <select value={thresholdType} onChange={(event) => setThresholdType(event.target.value as VoteThresholdType)} className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm">
              {Object.entries(THRESHOLD_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input type="number" min={0} value={customThreshold} onChange={(event) => setCustomThreshold(Number(event.target.value) || 0)} className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm" placeholder="門檻" />
            <button
              disabled={!voteTitle.trim() || busy}
              onClick={() =>
                run(async () => {
                  const vote = await meetingsApi.createVote(meeting.id, {
                    title: voteTitle.trim(),
                    agenda_item_id: meeting.current_agenda_item_id,
                    visibility: "named",
                    threshold_type: thresholdType,
                    pass_threshold: thresholdType === "custom" ? customThreshold : 0,
                  });
                  await meetingsApi.openVote(meeting.id, vote.id);
                  await meetingsApi.updateScreenState(meeting.id, {
                    reading_mode: "vote",
                    title: vote.title,
                    body: vote.description,
                  });
                  setVoteTitle("");
                }, "表決已開啟")
              }
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <Vote size={15} aria-hidden="true" />
              開啟
            </button>
          </div>
        </section>
      </section>

      <aside className="grid content-start gap-4">
        <section className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="mb-3 text-base font-semibold">發言 Queue</h2>
          <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
            <input value={speakerName} onChange={(event) => setSpeakerName(event.target.value)} placeholder="臨時新增發言人" className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm" />
            <button disabled={!speakerName.trim()} onClick={() => run(async () => {
              await meetingsApi.createSpeechQueueItem(meeting.id, {
                speaker_name: speakerName.trim(),
                agenda_item_id: meeting.current_agenda_item_id,
                duration_seconds: meeting.default_speech_seconds,
              });
              setSpeakerName("");
            }, "已加入發言 queue")} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <Plus size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="grid gap-2">
            {speechQueue.length === 0 && <p className="text-sm text-[var(--muted)]">目前沒有排隊發言。</p>}
            {speechQueue.map((item, index) => (
              <div key={item.id} className="rounded-md border border-[var(--border)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-[var(--muted)]">#{index + 1} · {item.status}</p>
                    <p className="font-medium">{item.speaker_name}</p>
                    <p className="text-xs text-[var(--muted)]">{formatSeconds(item.remaining_seconds)}</p>
                  </div>
                  <div className="flex gap-1">
                    {item.status === "queued" && (
                      <button onClick={() => run(() => meetingsApi.startSpeech(meeting.id, item.id), "已開始發言")} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs">
                        <Play size={13} aria-hidden="true" />
                      </button>
                    )}
                    <button onClick={() => run(() => meetingsApi.skipSpeech(meeting.id, item.id), "已略過")} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs">
                      <TimerReset size={13} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="mb-3 text-base font-semibold">議員請求</h2>
          <div className="grid gap-2">
            {pendingRequests.length === 0 && <p className="text-sm text-[var(--muted)]">目前沒有待處理請求。</p>}
            {pendingRequests.map((request: MeetingRequestOut) => (
              <div key={request.id} className="rounded-md border border-[var(--border)] p-3">
                <p className="text-sm font-medium">{request.user?.display_name || request.user_id}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{request.request_type}</p>
                {request.content && <p className="mt-2 whitespace-pre-wrap text-sm">{request.content}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {request.request_type === "speech" && (
                    <button onClick={() => run(() => meetingsApi.enqueueRequest(meeting.id, request.id), "已排入發言")} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs">
                      排入發言
                    </button>
                  )}
                  <button onClick={() => run(() => meetingsApi.updateRequest(meeting.id, request.id, "acknowledged"), "已標記處理")} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs">
                    已處理
                  </button>
                  <button onClick={() => run(() => meetingsApi.updateRequest(meeting.id, request.id, "dismissed"), "已略過")} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs">
                    略過
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="mb-3 text-base font-semibold">事件紀錄</h2>
          <div className="grid max-h-96 gap-2 overflow-y-auto text-xs">
            {[...(meeting.events ?? [])].reverse().slice(0, 20).map((event) => (
              <div key={event.id} className="rounded-md border border-[var(--border)] p-2">
                <p className="font-medium">{event.event_type}</p>
                <p className="text-[var(--muted)]">{new Date(event.created_at).toLocaleTimeString("zh-TW")}</p>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}
