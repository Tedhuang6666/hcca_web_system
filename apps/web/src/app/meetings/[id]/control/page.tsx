"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
<<<<<<< HEAD
  Bell,
  CheckCircle2,
  Clock,
  ExternalLink,
  Gavel,
  ListChecks,
  Megaphone,
  Mic,
=======
  ChevronRight,
  FileText,
  Gavel,
  ListChecks,
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
  Monitor,
  Pause,
  Play,
  Plus,
<<<<<<< HEAD
  Square,
  TimerReset,
  Vote,
} from "lucide-react";
import { meetingsApi } from "@/lib/api";
import { useWS } from "@/hooks/useWS";
import type {
  MeetingAgendaItemOut,
  MeetingOut,
  MeetingRequestOut,
  MeetingScreenOut,
  MeetingScreenReadingMode,
  MeetingSpeechQueueItemOut,
  VoteThresholdType,
} from "@/lib/types";
=======
  Send,
  Square,
  Type,
  Vote,
} from "lucide-react";
import { meetingsApi, regulationsApi } from "@/lib/api";
import { useWS } from "@/hooks/useWS";
import type {
  MeetingOut,
  MeetingAgendaItemOut,
  MeetingScreenOut,
  MeetingScreenReadingMode,
  MeetingScreenStateOut,
  RegulationArticleOut,
} from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  active: "進行中",
  paused: "暫停",
  closed: "已結束",
};
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71

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
<<<<<<< HEAD
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
  const [now, setNow] = useState(Date.now());
=======
  const [agendaTitle, setAgendaTitle] = useState("");
  const [agendaBody, setAgendaBody] = useState("");
  const [voteTitle, setVoteTitle] = useState("");
  const [focusTitle, setFocusTitle] = useState("");
  const [focusBody, setFocusBody] = useState("");
  const [readingMode, setReadingMode] = useState<MeetingScreenReadingMode>("article");
  // 法條朗讀：從議程上的法規直接選條文（取代手打）
  const [pickerRegId, setPickerRegId] = useState("");
  const [pickerArticles, setPickerArticles] = useState<RegulationArticleOut[]>([]);
  const [pickerArticleId, setPickerArticleId] = useState("");
  const [scrollPosition, setScrollPosition] = useState(0);
  const [scrollSpeed, setScrollSpeed] = useState(1);
  const [autoScroll, setAutoScroll] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71

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

<<<<<<< HEAD
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
=======
  const current = useMemo(
    () => meeting?.agenda_items.find((item) => item.id === meeting.current_agenda_item_id) ?? null,
    [meeting],
  );
  const openVote = meeting?.votes.find((item) => item.status === "open") ?? null;
  const pendingRequests = meeting?.requests.filter((item) => item.status === "pending") ?? [];
  const currentAttachments = current?.attachments ?? [];
  const nextOrder = () =>
    meeting?.agenda_items.length
      ? Math.max(...meeting.agenda_items.map((item) => item.order_index)) + 1
      : 0;

  // 議程上關聯到的法規（去重），供「法條朗讀」直接挑選條文
  const agendaRegulations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const it of meeting?.agenda_items ?? []) {
      if (it.regulation_id && it.regulation) seen.set(it.regulation_id, it.regulation.title);
    }
    return [...seen.entries()].map(([rid, title]) => ({ id: rid, title }));
  }, [meeting]);

  // 預設選取目前議程項目所關聯的法規
  useEffect(() => {
    if (current?.regulation_id) setPickerRegId((prev) => prev || current.regulation_id!);
  }, [current]);

  // 載入選定法規的條文
  useEffect(() => {
    if (!pickerRegId) {
      setPickerArticles([]);
      return;
    }
    let cancelled = false;
    regulationsApi
      .listArticles(pickerRegId)
      .then((arts) => {
        if (!cancelled) setPickerArticles(arts.filter((a) => !a.is_deleted));
      })
      .catch(() => {
        if (!cancelled) setPickerArticles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pickerRegId]);

  async function run<T>(action: () => Promise<T>, success = "操作已完成"): Promise<T | undefined> {
    setBusy(true);
    try {
      setNotice("處理中...");
      const result = await action();
      await load();
      setNotice(success);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失敗");
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
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

  async function pushScene(mode: MeetingScreenReadingMode, item?: MeetingAgendaItemOut | null) {
    if (!meeting) return;
<<<<<<< HEAD
    const target = item ?? current;
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
=======
    const state = await run<MeetingScreenStateOut>(() =>
      meetingsApi.updateScreenState(meeting.id, {
        agenda_item_id: meeting.current_agenda_item_id,
        reading_mode: readingMode,
        title: focusTitle || current?.title || null,
        body: focusBody || current?.description || null,
        scroll_position: scrollPosition,
        scroll_speed: scrollSpeed,
        auto_scroll: autoScroll,
        ...overrides,
      }),
    );
    if (state) {
      setMeeting((prev) =>
        prev
          ? {
              ...prev,
              current_agenda_item_id: state.agenda_item_id ?? prev.current_agenda_item_id,
              screen_state: state,
            }
          : prev,
      );
      setError("");
    }
  }

  async function selectAgendaAndPush(item: MeetingAgendaItemOut) {
    if (!meeting) return;
    setReadingMode("agenda");
    setFocusTitle(item.title);
    setFocusBody(item.description || "");
    setScrollPosition(0);
    await run(async () => {
      await meetingsApi.update(meeting.id, { current_agenda_item_id: item.id });
      return meetingsApi.updateScreenState(meeting.id, {
        agenda_item_id: item.id,
        reading_mode: "agenda",
        title: item.title,
        body: item.description || null,
        scroll_position: 0,
        auto_scroll: false,
      });
    });
  }

  if (error && !meeting) return <main className="p-6 text-sm text-red-500">{error}</main>;
  if (!meeting) return <main className="p-6 text-sm text-[var(--muted)]">載入中...</main>;

  // 此會議審議階段所對應、可由表決推進的法案狀態
  const intakeStatus =
    meeting.bill_stage === "standing_committee"
      ? "under_review"
      : meeting.bill_stage === "council"
        ? "scheduled"
        : null;
  const advanceLabel =
    meeting.bill_stage === "standing_committee" ? "排入議會議程" : "議會核定";
  const screenState = meeting.screen_state;
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71

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
<<<<<<< HEAD
=======
          <Link
            href={`/meetings/screen/${meeting.screen_token}`}
            target="_blank"
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            <Monitor size={16} aria-hidden="true" />
            公開大屏
          </Link>
        </div>

        {error && <p role="alert" className="mb-4 text-sm text-red-500">{error}</p>}
        {notice && <p role="status" aria-live="polite" className="mb-4 text-sm text-emerald-500">{notice}</p>}

        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
            狀態：{STATUS_LABEL[meeting.status] ?? meeting.status}
          </span>
          {(meeting.status === "draft" || meeting.status === "paused") && (
            <button
              onClick={() => run(() => meetingsApi.start(meeting.id))}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white">
              <Play size={15} aria-hidden="true" />
              {meeting.status === "paused" ? "繼續" : "開始"}
            </button>
          )}
          {meeting.status === "active" && (
            <button
              onClick={() => run(() => meetingsApi.pause(meeting.id))}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <Pause size={15} aria-hidden="true" />
              暫停
            </button>
          )}
          {(meeting.status === "active" || meeting.status === "paused") && (
            <button
              onClick={() => {
                if (confirm("確定結束會議？結束後將無法重新開啟。")) {
                  void run(() => meetingsApi.close(meeting.id));
                }
              }}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md border border-red-500 px-3 py-2 text-sm font-medium text-red-500">
              <Square size={15} aria-hidden="true" />
              結束
            </button>
          )}
          {meeting.status === "closed" && (
            <span className="text-sm text-[var(--muted)]">會議已結束</span>
          )}
        </div>

        <section className="mb-5 rounded-lg border border-[var(--border)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium text-[var(--muted)]">大屏目前顯示</p>
              <h2 className="mt-1 text-xl font-semibold">
                {screenState?.title || current?.title || "尚未選定"}
              </h2>
              {(screenState?.body || current?.description) && (
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm">
                  {screenState?.body || current?.description}
                </p>
              )}
            </div>
            <span className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">
              模式：{screenState?.reading_mode ?? "未設定"}
            </span>
          </div>
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
        </section>

        <section className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="mb-3 text-base font-semibold">議程</h2>
          <div className="grid gap-2">
<<<<<<< HEAD
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
=======
            {[...meeting.agenda_items].sort((a, b) => a.order_index - b.order_index).map((item) => (
              <div key={item.id} className="rounded-md border border-[var(--border)] p-3 text-sm">
                <button
                  onClick={() => void selectAgendaAndPush(item)}
                  className="flex w-full items-center justify-between gap-3 text-left">
                  <span>
                    {item.order_index + 1}. {item.title}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--primary)]">
                    推送 <ChevronRight size={15} aria-hidden="true" />
                  </span>
                </button>
                {item.regulation && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2 text-xs text-[var(--muted)]">
                    <span>
                      關聯法案《{item.regulation.title}》·{" "}
                      {WORKFLOW_LABEL[item.regulation.workflow_status]}
                    </span>
                    {intakeStatus && item.regulation.workflow_status === intakeStatus && (
                      <button
                        onClick={() =>
                          run(() => meetingsApi.advanceAgendaRegulation(meeting.id, item.id))
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-emerald-500">
                        <Gavel size={13} aria-hidden="true" />
                        表決通過 → {advanceLabel}
                      </button>
                    )}
                  </div>
                )}
              </div>
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
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
<<<<<<< HEAD
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
=======
          <h2 className="mb-3 text-lg font-semibold">即時朗讀 / 大屏遙控</h2>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              onClick={() =>
                pushScreenState({
                  reading_mode: "agenda",
                  title: current?.title || null,
                  body: current?.description || null,
                  scroll_position: 0,
                  auto_scroll: false,
                })
              }
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <ListChecks size={15} aria-hidden="true" />
              議程摘要
            </button>
            <button
              onClick={() =>
                pushScreenState({
                  reading_mode: "vote",
                  title: openVote?.title || "現場表決",
                  body: openVote?.description || null,
                  auto_scroll: false,
                })
              }
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <Vote size={15} aria-hidden="true" />
              表決畫面
            </button>
            <button
              onClick={() =>
                pushScreenState({
                  reading_mode: "article",
                  title: focusTitle || null,
                  body: focusBody || null,
                  scroll_position: 0,
                })
              }
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <FileText size={15} aria-hidden="true" />
              法條
            </button>
            <button
              onClick={() =>
                pushScreenState({
                  reading_mode: "free_text",
                  title: focusTitle || "主席提示",
                  body: focusBody || null,
                  scroll_position: 0,
                })
              }
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <Type size={15} aria-hidden="true" />
              自由文字
            </button>
          </div>
          <select
            value={readingMode}
            onChange={(e) => setReadingMode(e.target.value as MeetingScreenReadingMode)}
            className="mb-2 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm">
            <option value="article">法條朗讀</option>
            <option value="agenda">議程摘要</option>
            <option value="attachment">附件顯示</option>
            <option value="vote">表決畫面</option>
            <option value="free_text">自由文字</option>
          </select>
          {readingMode === "article" && (
            <div className="mb-2 grid gap-2 rounded-md border border-[var(--border)] p-2">
              <p className="text-xs text-[var(--muted)]">從議程法規直接挑選條文（免手打）</p>
              <select
                value={pickerRegId}
                onChange={(e) => {
                  setPickerRegId(e.target.value);
                  setPickerArticleId("");
                }}
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm">
                <option value="">— 選擇法規 —</option>
                {agendaRegulations.map((r) => (
                  <option key={r.id} value={r.id}>{r.title}</option>
                ))}
              </select>
              <select
                value={pickerArticleId}
                disabled={!pickerRegId || pickerArticles.length === 0}
                onChange={(e) => {
                  const art = pickerArticles.find((a) => a.id === e.target.value);
                  setPickerArticleId(e.target.value);
                  if (!art) return;
                  const title = art.legal_number || art.title || "";
                  const body = art.content || "";
                  setReadingMode("article");
                  setFocusTitle(title);
                  setFocusBody(body);
                  // 直接跳轉並推送到大屏
                  void pushScreenState({ reading_mode: "article", title, body });
                }}
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm disabled:opacity-50">
                <option value="">
                  {pickerRegId
                    ? pickerArticles.length === 0
                      ? "（此法規尚無條文）"
                      : "— 選擇條文，選定即推送 —"
                    : "— 請先選擇法規 —"}
                </option>
                {pickerArticles.map((a) => (
                  <option key={a.id} value={a.id}>
                    {(a.title || a.legal_number || "（未命名）") +
                      (a.content ? `　${a.content.slice(0, 20)}` : "")}
                  </option>
                ))}
              </select>
            </div>
          )}
          <input
            value={focusTitle}
            onChange={(e) => setFocusTitle(e.target.value)}
            placeholder="例如：第五條（或由上方挑選自動帶入）"
            className="mb-2 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
          <textarea
            value={focusBody}
            onChange={(e) => setFocusBody(e.target.value)}
            placeholder="輸入要顯示在大屏上的條文內容或重點摘要"
            className="mb-2 min-h-28 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
          {currentAttachments.length > 0 && (
            <div className="mb-2 grid gap-2">
              {currentAttachments.map((attachment) => (
                <button
                  key={attachment.id}
                  onClick={() =>
                    pushScreenState({
                      reading_mode: "attachment",
                      active_attachment_id: attachment.id,
                      title: attachment.display_name || attachment.filename,
                      body: attachment.link_url || attachment.filename,
                    })
                  }
                  className="truncate rounded-md border border-[var(--border)] px-3 py-2 text-left text-xs">
                  開啟附件：{attachment.display_name || attachment.filename}
                </button>
              ))}
            </div>
          )}
          <div className="mb-2 grid grid-cols-3 gap-2">
            <button
              onClick={() => {
                const next = Math.max(0, scrollPosition - 20);
                setScrollPosition(next);
                void pushScreenState({ scroll_position: next });
              }}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              上滑
            </button>
            <button
              onClick={() => {
                const next = scrollPosition + 20;
                setScrollPosition(next);
                void pushScreenState({ scroll_position: next });
              }}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              下滑
            </button>
            <button
              onClick={() => {
                const next = !autoScroll;
                setAutoScroll(next);
                void pushScreenState({ auto_scroll: next });
              }}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              {autoScroll ? "暫停滾動" : "自動滾動"}
            </button>
          </div>
          <label className="mb-2 flex items-center gap-2 text-xs text-[var(--muted)]">
            滾動速度
            <input
              type="range"
              min={0}
              max={10}
              value={scrollSpeed}
              onChange={(e) => setScrollSpeed(Number(e.target.value))}
              className="flex-1"
            />
            {scrollSpeed}
          </label>
          <button
            onClick={() => pushScreenState()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-black">
            <Send size={15} aria-hidden="true" />
            推送到大屏
          </button>
        </section>

        <section className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="mb-3 text-lg font-semibold">表決控制</h2>
          {openVote ? (
            <div className="mb-3 rounded-md border border-green-500/40 p-3">
              <p className="font-medium">{openVote.title}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                投票率 {openVote.tally?.total ?? 0}/{openVote.tally?.eligible ?? 0}
              </p>
              <button
                onClick={() => run(() => meetingsApi.closeVote(meeting.id, openVote.id))}
                className="mt-3 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                關閉表決
              </button>
            </div>
          ) : (
            <p className="mb-3 text-sm text-[var(--muted)]">目前沒有開啟中的表決。</p>
          )}
          <input
            value={voteTitle}
            onChange={(e) => setVoteTitle(e.target.value)}
            placeholder="表決案標題"
            className="mb-2 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
          <button
            onClick={() => run(async () => {
              const vote = await meetingsApi.createVote(meeting.id, {
                title: voteTitle,
                agenda_item_id: meeting.current_agenda_item_id,
                visibility: "named",
              });
              await meetingsApi.openVote(meeting.id, vote.id);
              setVoteTitle("");
            })}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            <Vote size={15} aria-hidden="true" />
            建立並開啟表決
          </button>
        </section>

        <section className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="mb-3 text-lg font-semibold">議員請求</h2>
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
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
