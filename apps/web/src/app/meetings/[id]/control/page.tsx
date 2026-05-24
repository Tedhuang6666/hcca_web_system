"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  FileText,
  Gavel,
  ListChecks,
  Monitor,
  Pause,
  Play,
  Plus,
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

const WORKFLOW_LABEL: Record<string, string> = {
  draft: "草稿",
  under_review: "送審中",
  scheduled: "已排入議程",
  council_approved: "議會核定",
  published: "已公布",
  rejected: "已退回",
  archived: "已廢止",
};

export default function MeetingControlPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [meeting, setMeeting] = useState<MeetingOut | null>(null);
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

  useEffect(() => {
    void params.then(({ id: nextId }) => setId(nextId));
  }, [params]);

  const load = useCallback(async (nextId = id) => {
    if (!nextId) return;
    try {
      setMeeting(await meetingsApi.get(nextId));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入控制台失敗");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useWS(
    id ? `meeting:${id}` : null,
    (msg) => {
      const data = msg.data as MeetingScreenOut | undefined;
      if (data?.meeting) setMeeting(data.meeting);
    },
    Boolean(id),
  );

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
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function pushScreenState(overrides: Record<string, unknown> = {}) {
    if (!meeting) return;
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

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-6 xl:grid-cols-[1.1fr_0.9fr]">
      <section>
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">議場遙控台</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">{meeting.title}</p>
          </div>
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
        </section>

        <section className="mb-5 rounded-lg border border-[var(--border)] p-4">
          <h2 className="mb-3 text-lg font-semibold">議程遙控</h2>
          <div className="grid gap-2">
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
            ))}
          </div>
          <div className="mt-4 grid gap-2">
            <input
              value={agendaTitle}
              onChange={(e) => setAgendaTitle(e.target.value)}
              placeholder="新增議程標題"
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            />
            <textarea
              value={agendaBody}
              onChange={(e) => setAgendaBody(e.target.value)}
              placeholder="大綱、條文摘要或說明"
              className="min-h-24 rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            />
            <button
              onClick={() => run(async () => {
                if (!agendaTitle.trim()) {
                  setError("請先輸入議程標題");
                  return;
                }
                await meetingsApi.addAgendaItem(meeting.id, {
                  title: agendaTitle.trim(),
                  description: agendaBody.trim() || null,
                  item_type: "manual",
                  order_index: nextOrder(),
                });
                setAgendaTitle("");
                setAgendaBody("");
              })}
              disabled={!agendaTitle.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <Plus size={15} aria-hidden="true" />
              新增議程
            </button>
          </div>
        </section>
      </section>

      <aside className="grid content-start gap-5">
        <section className="rounded-lg border border-[var(--border)] p-4">
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
          <div className="grid gap-2">
            {pendingRequests.map((item) => (
              <div key={item.id} className="rounded-md border border-[var(--border)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {item.request_type === "speech"
                        ? "請求發言"
                        : item.request_type === "point_of_order"
                          ? "秩序問題"
                          : "權宜問題"}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {item.user?.display_name || item.user_id}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => run(() => meetingsApi.updateRequest(meeting.id, item.id, "acknowledged"))}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs">
                      已處理
                    </button>
                    <button
                      onClick={() => run(() => meetingsApi.updateRequest(meeting.id, item.id, "dismissed"))}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs">
                      略過
                    </button>
                  </div>
                </div>
                {item.content && <p className="mt-2 whitespace-pre-wrap text-sm">{item.content}</p>}
              </div>
            ))}
            {pendingRequests.length === 0 && (
              <p className="text-sm text-[var(--muted)]">目前沒有待處理請求。</p>
            )}
          </div>
        </section>
      </aside>
    </main>
  );
}
