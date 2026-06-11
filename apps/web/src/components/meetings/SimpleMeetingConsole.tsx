"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  FileText,
  Gavel,
  Monitor,
  Play,
  Square,
  UserX,
  Vote,
} from "lucide-react";
import { meetingsApi } from "@/lib/api";
import { useWS } from "@/hooks/useWS";
import UserPicker from "@/components/surveys/UserPicker";
import type {
  MeetingAgendaItemOut,
  MeetingAttendanceOut,
  MeetingOut,
  MeetingVoteOption,
  UserSummary,
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

const ATTENDANCE_OPTIONS: { value: "present" | "absent" | "leave"; label: string }[] = [
  { value: "present", label: "出席" },
  { value: "leave", label: "請假" },
  { value: "absent", label: "缺席" },
];

const CHOICE_LABEL: Record<string, string> = {
  approve: "同意",
  reject: "不同意",
  abstain: "棄權",
};

export default function SimpleMeetingConsole({ meetingId }: { meetingId: string }) {
  const [meeting, setMeeting] = useState<MeetingOut | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // 表決面板狀態（針對目前議程案）
  const [votePanel, setVotePanel] = useState<"none" | "tally" | "named">("none");
  const [voteTitle, setVoteTitle] = useState("");
  const [useCustomOptions, setUseCustomOptions] = useState(false);
  const [optionsText, setOptionsText] = useState("甲案\n乙案");
  const [tallyApprove, setTallyApprove] = useState(0);
  const [tallyReject, setTallyReject] = useState(0);
  const [tallyAbstain, setTallyAbstain] = useState(0);
  const [tallyCustom, setTallyCustom] = useState<Record<string, number>>({});
  const [decisionContent, setDecisionContent] = useState("");
  const [decisionAssignees, setDecisionAssignees] = useState<UserSummary[]>([]);
  const [decisionDueAt, setDecisionDueAt] = useState("");
  const [decisionDocument, setDecisionDocument] = useState(false);

  const load = useCallback(async () => {
    try {
      setMeeting(await meetingsApi.get(meetingId));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入議場失敗");
    }
  }, [meetingId]);

  useEffect(() => {
    void load();
  }, [load]);

  useWS(
    `meeting:${meetingId}`,
    (msg) => {
      const data = msg.data as { meeting?: MeetingOut } | undefined;
      if (data?.meeting) setMeeting(data.meeting);
    },
    Boolean(meetingId),
  );

  async function run<T>(action: () => Promise<T>, success = "已更新") {
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
    () => agenda.find((item) => item.id === meeting?.current_agenda_item_id) ?? agenda[0] ?? null,
    [agenda, meeting?.current_agenda_item_id],
  );

  // 出席名冊（具表決權委員優先；簡易模式以勾選為主）
  const roster = useMemo(
    () =>
      [...(meeting?.attendance_records ?? [])].sort((a, b) =>
        (a.user?.display_name ?? "").localeCompare(b.user?.display_name ?? "", "zh-Hant"),
      ),
    [meeting],
  );
  const presentVoters = roster.filter(
    (r) => r.status === "present" && r.is_voting_eligible,
  );

  const parsedOptions = useMemo<MeetingVoteOption[]>(
    () =>
      optionsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((label, idx) => ({ key: `opt${idx + 1}`, label })),
    [optionsText],
  );

  function resetVotePanel() {
    setVotePanel("none");
    setVoteTitle("");
    setUseCustomOptions(false);
    setTallyApprove(0);
    setTallyReject(0);
    setTallyAbstain(0);
    setTallyCustom({});
  }

  async function pushAgendaToScreen(item: MeetingAgendaItemOut) {
    await meetingsApi.update(meeting!.id, { current_agenda_item_id: item.id });
    await meetingsApi.updateScreenState(meeting!.id, {
      agenda_item_id: item.id,
      reading_mode: "agenda",
      title: item.title,
      body: item.description,
    });
  }

  function gotoNext() {
    if (!meeting || !current) return;
    const idx = agenda.findIndex((x) => x.id === current.id);
    const next = agenda[idx + 1];
    if (!next) {
      setNotice("已是最後一案");
      return;
    }
    resetVotePanel();
    void run(() => pushAgendaToScreen(next), `切換到第 ${next.order_index + 1} 案`);
  }

  async function toggleRecusal(record: MeetingAttendanceOut) {
    if (!meeting || !current) return;
    const recused = current.recusals.some((r) => r.user_id === record.user_id);
    await run(
      () =>
        recused
          ? meetingsApi.removeRecusal(meeting.id, current.id, record.user_id)
          : meetingsApi.addRecusal(meeting.id, current.id, { user_id: record.user_id }),
      recused ? "已取消迴避" : "已標記迴避",
    );
  }

  async function doAcclamation() {
    if (!meeting || !current) return;
    await run(
      () => meetingsApi.acclamation(meeting.id, current.id, { title: current.title }),
      "已記為無異議通過",
    );
    resetVotePanel();
  }

  async function submitTally() {
    if (!meeting || !current) return;
    const title = voteTitle.trim() || current.title;
    const manual_tally = useCustomOptions
      ? Object.fromEntries(parsedOptions.map((o) => [o.key, tallyCustom[o.key] ?? 0]))
      : { approve: tallyApprove, reject: tallyReject, abstain: tallyAbstain };
    await run(async () => {
      const vote = await meetingsApi.createVote(meeting.id, {
        title,
        agenda_item_id: current.id,
        record_method: "tally",
        options: useCustomOptions ? parsedOptions : null,
      });
      await meetingsApi.recordTally(meeting.id, vote.id, { manual_tally });
      await meetingsApi.updateScreenState(meeting.id, {
        reading_mode: "result",
        title,
        body: null,
      });
    }, "已記錄計票結果");
    resetVotePanel();
  }

  async function startNamedVote() {
    if (!meeting || !current) return;
    const title = voteTitle.trim() || current.title;
    await run(async () => {
      const vote = await meetingsApi.createVote(meeting.id, {
        title,
        agenda_item_id: current.id,
        visibility: "named",
        record_method: "ballots",
        options: useCustomOptions ? parsedOptions : null,
      });
      await meetingsApi.openVote(meeting.id, vote.id);
      await meetingsApi.updateScreenState(meeting.id, {
        reading_mode: "vote",
        title,
        body: null,
      });
    }, "已開始逐人表決");
  }

  const namedVote = useMemo(
    () =>
      meeting?.votes.find(
        (v) => v.agenda_item_id === current?.id && v.status === "open" && v.record_method === "ballots",
      ) ?? null,
    [meeting, current],
  );

  async function recordNamed(record: MeetingAttendanceOut, choiceOrKey: string) {
    if (!meeting || !namedVote) return;
    const body = voteUsesCustomOptions(namedVote)
      ? { voter_id: record.user_id, option_key: choiceOrKey }
      : { voter_id: record.user_id, choice: choiceOrKey as "approve" | "reject" | "abstain" };
    await run(() => meetingsApi.recorderBallot(meeting.id, namedVote.id, body), "已記錄");
  }

  function voteUsesCustomOptions(vote: NonNullable<typeof namedVote>) {
    return Boolean(vote.options && vote.options.length);
  }

  async function closeNamedVote() {
    if (!meeting || !namedVote) return;
    await run(() => meetingsApi.closeVote(meeting.id, namedVote.id), "表決結束");
    resetVotePanel();
  }

  async function createIntegratedDecision() {
    if (!meeting || !current || !decisionContent.trim()) return;
    await run(async () => {
      await meetingsApi.createDecision(meeting.id, {
        agenda_item_id: current.id,
        title: current.title,
        content: decisionContent.trim(),
        status: "passed",
        create_follow_up: true,
        follow_up_assignee_id: decisionAssignees[0]?.id ?? null,
        follow_up_due_at: decisionDueAt ? new Date(decisionDueAt).toISOString() : null,
        create_document_draft: decisionDocument,
      });
      setDecisionContent("");
      setDecisionAssignees([]);
      setDecisionDueAt("");
      setDecisionDocument(false);
    }, "正式決議、待辦與跨模組項目已建立");
  }

  if (error && !meeting) return <main className="p-6 text-sm text-red-500">{error}</main>;
  if (!meeting) return <main className="p-6 text-sm text-[var(--muted)]">載入議場...</main>;

  const currentRecusedIds = new Set(current?.recusals.map((r) => r.user_id) ?? []);

  return (
    <main className="grid min-h-screen gap-4 px-4 py-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
      {/* ── 左：議程進度 ───────────────────────────────────────────── */}
      <aside className="grid content-start gap-4">
        <section className="rounded-lg border border-[var(--border)] p-4">
          <p className="text-xs font-medium text-[var(--muted)]">簡易評議 · 議場</p>
          <h1 className="mt-1 text-xl font-semibold">{meeting.title}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {STATUS_LABEL[meeting.status] ?? meeting.status}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link
              href={`/meetings/screen/${meeting.screen_token}`}
              target="_blank"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <Monitor size={15} aria-hidden="true" /> 大屏
            </Link>
            <Link
              href={`/meetings/${meeting.id}`}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <ExternalLink size={15} aria-hidden="true" /> 會議
            </Link>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {meeting.status === "draft" || meeting.status === "confirmed" ? (
              <button
                disabled={busy}
                onClick={() => run(() => meetingsApi.start(meeting.id), "會議開始")}
                className="inline-flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white">
                <Play size={15} aria-hidden="true" /> 開始會議
              </button>
            ) : meeting.status !== "closed" && meeting.status !== "archived" ? (
              <button
                disabled={busy}
                onClick={() =>
                  confirm("確定結束會議？") &&
                  void run(() => meetingsApi.close(meeting.id), "會議已結束")
                }
                className="inline-flex items-center gap-2 rounded-md border border-red-500 px-3 py-2 text-sm text-red-500">
                <Square size={15} aria-hidden="true" /> 結束會議
              </button>
            ) : (
              <Link
                href={`/meetings/${meeting.id}#minutes`}
                className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                <Gavel size={15} aria-hidden="true" /> 會議紀錄
              </Link>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="mb-3 text-base font-semibold">議程</h2>
          <div className="grid gap-2">
            {agenda.length === 0 && (
              <p className="text-sm text-[var(--muted)]">尚未建立議程，請先到會議頁新增議程案。</p>
            )}
            {agenda.map((item) => {
              const decided = Boolean(item.resolution);
              return (
                <button
                  key={item.id}
                  disabled={busy}
                  onClick={() => {
                    resetVotePanel();
                    void run(() => pushAgendaToScreen(item), "已切換議程");
                  }}
                  className={`rounded-md border px-3 py-2 text-left text-sm ${
                    item.id === current?.id
                      ? "border-[var(--primary)] bg-[var(--primary-dim)]"
                      : "border-[var(--border)]"
                  }`}>
                  <span className="flex items-center justify-between text-xs text-[var(--muted)]">
                    <span>第 {item.order_index + 1} 案</span>
                    {decided && <CheckCircle2 size={13} className="text-emerald-500" aria-label="已做成決議" />}
                  </span>
                  <span className="font-medium">{item.title}</span>
                </button>
              );
            })}
          </div>
        </section>
      </aside>

      {/* ── 中：目前議程案 ─────────────────────────────────────────── */}
      <section className="grid content-start gap-4">
        {error && <p className="rounded-md border border-red-500/40 p-3 text-sm text-red-500">{error}</p>}
        {notice && <p className="rounded-md border border-emerald-500/40 p-3 text-sm text-emerald-500">{notice}</p>}

        {current ? (
          <section className="rounded-lg border border-[var(--border)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-[var(--muted)]">第 {current.order_index + 1} 案</p>
                <h2 className="mt-1 text-xl font-semibold">{current.title}</h2>
              </div>
              <button
                disabled={busy}
                onClick={gotoNext}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                下一案 <ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>
            {current.description && (
              <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--muted)]">{current.description}</p>
            )}

            {/* 討論摘要 */}
            <label className="mt-4 block text-sm">
              <span className="text-xs font-medium text-[var(--muted)]">討論摘要（寫入會議紀錄）</span>
              <textarea
                defaultValue={current.notes ?? ""}
                key={current.id}
                onBlur={(e) =>
                  e.target.value !== (current.notes ?? "") &&
                  void run(
                    () => meetingsApi.updateAgendaItem(meeting.id, current.id, { notes: e.target.value }),
                    "已儲存討論摘要",
                  )
                }
                rows={2}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                placeholder="記錄討論重點..."
              />
            </label>

            {current.resolution && (
              <p className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
                <span className="font-medium">決議：</span>
                {current.resolution}
              </p>
            )}

            <div className="mt-4 grid gap-3 rounded-md border border-[var(--border)] p-3">
              <div>
                <p className="text-sm font-semibold">決議後續整合</p>
                <p className="text-xs text-[var(--muted)]">
                  建立正式決議後，自動產生待辦；期限會同步到行事曆與提醒。
                </p>
              </div>
              <textarea
                value={decisionContent}
                onChange={(event) => setDecisionContent(event.target.value)}
                rows={3}
                className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                placeholder="輸入正式決議內容與執行要求"
              />
              <UserPicker
                value={decisionAssignees}
                onChange={(users) => setDecisionAssignees(users.slice(-1))}
              />
              <input
                type="datetime-local"
                value={decisionDueAt}
                onChange={(event) => setDecisionDueAt(event.target.value)}
                className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                aria-label="決議執行期限"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={decisionDocument}
                  onChange={(event) => setDecisionDocument(event.target.checked)}
                />
                <FileText size={15} aria-hidden="true" />
                同時建立公文草稿
              </label>
              <button
                type="button"
                disabled={!decisionContent.trim() || busy}
                onClick={createIntegratedDecision}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-black"
              >
                <CheckCircle2 size={15} aria-hidden="true" />
                建立正式決議與後續工作
              </button>
            </div>

            {/* 表決區 */}
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <p className="mb-2 text-xs font-medium text-[var(--muted)]">表決</p>
              {namedVote ? (
                <NamedVotePanel
                  voters={presentVoters.filter((r) => !currentRecusedIds.has(r.user_id))}
                  vote={namedVote}
                  busy={busy}
                  onRecord={recordNamed}
                  onClose={closeNamedVote}
                />
              ) : votePanel === "none" ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={busy}
                    onClick={doAcclamation}
                    className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-black">
                    <CheckCircle2 size={15} aria-hidden="true" /> 無異議通過
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setVoteTitle(current.title);
                      setVotePanel("tally");
                    }}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                    <Vote size={15} aria-hidden="true" /> 計票
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setVoteTitle(current.title);
                      setVotePanel("named");
                    }}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                    <Vote size={15} aria-hidden="true" /> 逐人表決
                  </button>
                </div>
              ) : (
                <div className="grid gap-3">
                  <input
                    value={voteTitle}
                    onChange={(e) => setVoteTitle(e.target.value)}
                    placeholder="表決案標題"
                    className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={useCustomOptions}
                      onChange={(e) => setUseCustomOptions(e.target.checked)}
                    />
                    使用自訂選項（每行一個，例如 甲案 / 乙案）
                  </label>
                  {useCustomOptions && (
                    <textarea
                      value={optionsText}
                      onChange={(e) => setOptionsText(e.target.value)}
                      rows={3}
                      className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                    />
                  )}

                  {votePanel === "tally" && (
                    <div className="grid gap-2">
                      {useCustomOptions ? (
                        parsedOptions.map((opt) => (
                          <label key={opt.key} className="flex items-center gap-2 text-sm">
                            <span className="w-24 shrink-0">{opt.label}</span>
                            <input
                              type="number"
                              min={0}
                              value={tallyCustom[opt.key] ?? 0}
                              onChange={(e) =>
                                setTallyCustom((prev) => ({ ...prev, [opt.key]: Number(e.target.value) || 0 }))
                              }
                              className="w-24 rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
                            />
                          </label>
                        ))
                      ) : (
                        <div className="grid grid-cols-3 gap-2">
                          <NumberField label="同意" value={tallyApprove} onChange={setTallyApprove} />
                          <NumberField label="不同意" value={tallyReject} onChange={setTallyReject} />
                          <NumberField label="棄權" value={tallyAbstain} onChange={setTallyAbstain} />
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          disabled={busy}
                          onClick={submitTally}
                          className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-black">
                          記錄結果
                        </button>
                        <button onClick={resetVotePanel} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                          取消
                        </button>
                      </div>
                    </div>
                  )}

                  {votePanel === "named" && (
                    <div className="flex gap-2">
                      <button
                        disabled={busy}
                        onClick={startNamedVote}
                        className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-black">
                        開始逐人表決
                      </button>
                      <button onClick={resetVotePanel} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                        取消
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="rounded-lg border border-[var(--border)] p-6 text-sm text-[var(--muted)]">
            尚無議程案。請先到會議頁建立議程。
          </section>
        )}
      </section>

      {/* ── 右：出席點名 + 迴避 ────────────────────────────────────── */}
      <aside className="grid content-start gap-4">
        <section className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="mb-1 text-base font-semibold">出席點名</h2>
          <p className="mb-3 text-xs text-[var(--muted)]">
            出席表決權 {presentVoters.length} 人
          </p>
          <div className="grid max-h-[60vh] gap-2 overflow-y-auto">
            {roster.length === 0 && (
              <p className="text-sm text-[var(--muted)]">尚無名冊，請到會議頁匯入委員。</p>
            )}
            {roster.map((record) => {
              const recused = currentRecusedIds.has(record.user_id);
              return (
                <div key={record.id} className="rounded-md border border-[var(--border)] p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {record.user?.display_name ?? record.user_id}
                    </span>
                    {record.is_voting_eligible && current && (
                      <button
                        disabled={busy}
                        onClick={() => toggleRecusal(record)}
                        title={recused ? "取消迴避" : "標記對本案迴避"}
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
                          recused ? "bg-amber-500/20 text-amber-600" : "text-[var(--muted)]"
                        }`}>
                        <UserX size={12} aria-hidden="true" /> {recused ? "迴避中" : "迴避"}
                      </button>
                    )}
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    {ATTENDANCE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => meetingsApi.updateAttendance(meeting.id, record.id, { status: opt.value }),
                            "已更新出席",
                          )
                        }
                        className={`flex-1 rounded px-2 py-1 text-xs ${
                          record.status === opt.value
                            ? "bg-[var(--primary)] text-black"
                            : "border border-[var(--border)]"
                        }`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] p-4">
          <h2 className="mb-3 text-base font-semibold">事件紀錄</h2>
          <div className="grid max-h-72 gap-2 overflow-y-auto text-xs">
            {[...(meeting.events ?? [])].reverse().slice(0, 20).map((event) => (
              <div key={event.id} className="rounded-md border border-[var(--border)] p-2">
                <p className="font-medium">{event.event_type}</p>
                <p className="text-[var(--muted)]">
                  {new Date(event.created_at).toLocaleTimeString("zh-TW")}
                </p>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm"
      />
    </label>
  );
}

function NamedVotePanel({
  voters,
  vote,
  busy,
  onRecord,
  onClose,
}: {
  voters: MeetingAttendanceOut[];
  vote: NonNullable<MeetingOut["votes"][number]>;
  busy: boolean;
  onRecord: (record: MeetingAttendanceOut, choiceOrKey: string) => void;
  onClose: () => void;
}) {
  const custom = Boolean(vote.options && vote.options.length);
  const choices = custom
    ? (vote.options as MeetingVoteOption[]).map((o) => ({ key: o.key, label: o.label }))
    : [
        { key: "approve", label: CHOICE_LABEL.approve },
        { key: "reject", label: CHOICE_LABEL.reject },
        { key: "abstain", label: CHOICE_LABEL.abstain },
      ];
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{vote.title}（逐人表決進行中）</p>
        <button
          disabled={busy}
          onClick={onClose}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm">
          結束表決
        </button>
      </div>
      <div className="grid gap-2">
        {voters.length === 0 && (
          <p className="text-sm text-[var(--muted)]">無可表決的出席委員。</p>
        )}
        {voters.map((record) => {
          const ballot = vote.ballots.find((b) => b.voter_id === record.user_id);
          const chosen = custom ? ballot?.option_key : ballot?.choice;
          return (
            <div key={record.id} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] p-2">
              <span className="text-sm">{record.user?.display_name ?? record.user_id}</span>
              <div className="flex gap-1">
                {choices.map((c) => (
                  <button
                    key={c.key}
                    disabled={busy}
                    onClick={() => onRecord(record, c.key)}
                    className={`rounded px-2 py-1 text-xs ${
                      chosen === c.key ? "bg-[var(--primary)] text-black" : "border border-[var(--border)]"
                    }`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
