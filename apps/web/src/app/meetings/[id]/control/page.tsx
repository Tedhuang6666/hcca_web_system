"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Gavel, Monitor, Pause, Play, Plus, Square, Vote } from "lucide-react";
import { meetingsApi } from "@/lib/api";
import { useWS } from "@/hooks/useWS";
import type { MeetingOut, MeetingScreenOut, MeetingScreenReadingMode } from "@/lib/types";

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
  const [scrollPosition, setScrollPosition] = useState(0);
  const [scrollSpeed, setScrollSpeed] = useState(1);
  const [autoScroll, setAutoScroll] = useState(false);
  const [error, setError] = useState("");

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

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失敗");
    }
  }

  async function pushScreenState(overrides: Record<string, unknown> = {}) {
    if (!meeting) return;
    await run(() =>
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

        {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

        <div className="mb-5 flex flex-wrap gap-2">
          <button
            onClick={() => run(() => meetingsApi.start(meeting.id))}
            className="inline-flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white">
            <Play size={15} aria-hidden="true" />
            開始
          </button>
          <button
            onClick={() => run(() => meetingsApi.pause(meeting.id))}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            <Pause size={15} aria-hidden="true" />
            暫停
          </button>
          <button
            onClick={() => run(() => meetingsApi.close(meeting.id))}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            <Square size={15} aria-hidden="true" />
            結束
          </button>
        </div>

        <section className="mb-5 rounded-lg border border-[var(--border)] p-4">
          <p className="text-xs font-medium text-[var(--muted)]">大屏目前議案</p>
          <h2 className="mt-1 text-xl font-semibold">{current?.title || "尚未選定"}</h2>
          {current?.description && <p className="mt-2 whitespace-pre-wrap text-sm">{current.description}</p>}
        </section>

        <section className="mb-5 rounded-lg border border-[var(--border)] p-4">
          <h2 className="mb-3 text-lg font-semibold">議程遙控</h2>
          <div className="grid gap-2">
            {[...meeting.agenda_items].sort((a, b) => a.order_index - b.order_index).map((item) => (
              <div key={item.id} className="rounded-md border border-[var(--border)] p-3 text-sm">
                <button
                  onClick={() => run(() => meetingsApi.update(meeting.id, { current_agenda_item_id: item.id }))}
                  className="flex w-full items-center justify-between text-left">
                  <span>
                    {item.order_index + 1}. {item.title}
                  </span>
                  <ChevronRight size={15} aria-hidden="true" />
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
          <input
            value={focusTitle}
            onChange={(e) => setFocusTitle(e.target.value)}
            placeholder="例如：第五條"
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
            className="w-full rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-black">
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
