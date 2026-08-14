"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { Check, Copy, History, Lock, Monitor, Smartphone, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { electionsApi } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
import GovernanceLinkPanel from "@/components/governance/GovernanceLinkPanel";
import type {
  BallotBoxStatus,
  ElectionLiveSummary,
  ElectionOut,
  ElectionStatus,
  VoteEventKind,
  VoteEventOut,
} from "@/lib/types";

const boxStatusLabel: Record<BallotBoxStatus, string> = {
  pending: "尚未開始",
  counting: "開票中",
  paused: "已暫停",
  locked: "已鎖定",
};

const boxStatusTone: Record<BallotBoxStatus, string> = {
  pending: "var(--text-muted)",
  counting: "var(--success)",
  paused: "var(--warning)",
  locked: "var(--danger)",
};

const electionStatusLabel: Record<ElectionStatus, string> = {
  draft: "草稿",
  live: "開票中",
  paused: "暫停",
  closed: "已結束",
};
const electionStatusTone: Record<ElectionStatus, string> = {
  draft: "var(--text-muted)",
  live: "var(--success)",
  paused: "var(--warning)",
  closed: "var(--info)",
};

export default function ElectionCountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [election, setElection] = useState<ElectionOut | null>(null);
  const [summary, setSummary] = useState<ElectionLiveSummary | null>(null);
  const [events, setEvents] = useState<VoteEventOut[]>([]);
  const [boxId, setBoxId] = useState("");
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [manualFor, setManualFor] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    const [detail, live, history] = await Promise.all([
      electionsApi.get(id),
      electionsApi.live(id),
      electionsApi.events(id, 80),
    ]);
    setElection(detail);
    setSummary(live);
    setEvents(history);
    setBoxId((current) => current || detail.ballot_boxes[0]?.id || "");
  }, [id]);

  useEffect(() => {
    reload().catch(() => toast.error("無法載入開票控制台"));
  }, [reload]);

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失敗");
    } finally {
      setBusy(false);
    }
  }

  function addVote(candidateId: string | null, delta: number, kind: VoteEventKind) {
    if (!boxId) return;
    return run(
      () =>
        electionsApi.addEvent(id, {
          ballot_box_id: boxId,
          candidate_id: candidateId,
          kind,
          delta,
          reason: delta > 0 ? "正常唱票" : "人工更正",
        }),
      `${delta > 0 ? "+" : ""}${delta} 票已記錄`,
    );
  }

  function submitManual(key: string, candidateId: string | null, kind: VoteEventKind) {
    const delta = Number(manualValues[key]);
    if (!Number.isInteger(delta) || delta === 0) {
      toast.error("請輸入非 0 的整數");
      return;
    }
    setManualValues((values) => ({ ...values, [key]: "" }));
    setManualFor(null);
    void addVote(candidateId, delta, kind);
  }

  async function copyShareLink() {
    if (!election) return;
    const ref = election.slug ?? election.id;
    const url = `${window.location.origin}/live/elections/${encodeURIComponent(ref)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("已複製公開看板連結");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("複製失敗，請手動複製網址");
    }
  }

  if (!election || !summary) return <div className="card p-8">載入控制台中…</div>;

  const shareRef = encodeURIComponent(election.slug ?? election.id);
  const selectedBox = election.ballot_boxes.find((box) => box.id === boxId);
  const canCount = election.status === "live" && selectedBox?.status === "counting";
  const lockReason =
    election.status === "draft"
      ? "選舉尚未開始，請先按「開始開票」"
      : election.status === "paused"
        ? "全場開票已暫停，請先按「恢復開票」"
        : election.status === "closed"
          ? "選舉已結束，票數已封存"
          : !selectedBox
            ? "請先選擇票匭"
            : selectedBox.status !== "counting"
              ? `「${selectedBox.name}」目前${boxStatusLabel[selectedBox.status]}，請先按「開始／恢復此票匭」`
              : "";

  const electionActions: { status: ElectionStatus; label: string }[] =
    election.status === "draft"
      ? [{ status: "live", label: "開始開票" }]
      : election.status === "live"
        ? [{ status: "paused", label: "暫停" }, { status: "closed", label: "結束" }]
        : election.status === "paused"
          ? [{ status: "live", label: "恢復" }, { status: "closed", label: "結束" }]
          : [];

  const tileCount = election.candidates.length + 1;
  const colClass =
    tileCount <= 2
      ? "grid-cols-1 sm:grid-cols-2"
      : tileCount <= 4
        ? "grid-cols-2"
        : tileCount <= 6
          ? "grid-cols-2 sm:grid-cols-3"
          : tileCount <= 9
            ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-3"
            : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

  const memberNames = (members: ElectionOut["candidates"][number]["members"]) =>
    members.map((member) => `${member.position} ${member.name}`.trim()).join("、");

  // 以「函式回傳 JSX」內聯渲染（非 <Component/>），避免每次渲染建立新元件型別而導致輸入框失焦
  const renderControls = (candidateId: string | null, kind: VoteEventKind, manualKey: string) => (
    <div className="mt-auto space-y-1.5">
      <button
        disabled={busy}
        className="btn btn-primary h-11 w-full text-base font-bold"
        onClick={() => addVote(candidateId, 1, kind)}
      >
        +1
      </button>
      <div className="grid grid-cols-4 gap-1.5">
        <button disabled={busy} className="btn btn-secondary btn-sm" onClick={() => addVote(candidateId, -1, kind)}>-1</button>
        <button disabled={busy} className="btn btn-secondary btn-sm" onClick={() => addVote(candidateId, 5, kind)}>+5</button>
        <button disabled={busy} className="btn btn-secondary btn-sm" onClick={() => addVote(candidateId, 10, kind)}>+10</button>
        <button
          disabled={busy}
          className="btn btn-ghost btn-sm"
          aria-label="手動輸入票數"
          onClick={() => setManualFor((current) => (current === manualKey ? null : manualKey))}
        >
          ⋯
        </button>
      </div>
    </div>
  );

  const renderManual = (manualKey: string, candidateId: string | null, kind: VoteEventKind) =>
    manualFor !== manualKey ? null : (
      <div
        className="absolute inset-0 z-10 flex flex-col gap-2 rounded-[inherit] border p-3"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between">
          <strong className="text-sm">手動記錄票數</strong>
          <button className="btn btn-ghost btn-sm" aria-label="關閉" onClick={() => setManualFor(null)}>
            <X size={14} />
          </button>
        </div>
        <input
          type="number"
          step={1}
          autoFocus
          className="input"
          placeholder="例如 23 或 -2"
          value={manualValues[manualKey] ?? ""}
          onChange={(event) => setManualValues((values) => ({ ...values, [manualKey]: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitManual(manualKey, candidateId, kind);
          }}
        />
        <div className="mt-auto grid grid-cols-2 gap-2">
          <button className="btn btn-secondary" onClick={() => setManualFor(null)}>取消</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => submitManual(manualKey, candidateId, kind)}>記錄</button>
        </div>
      </div>
    );

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-3">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-bold sm:text-xl">{election.title}</h1>
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ color: electionStatusTone[election.status], background: "var(--bg-hover)" }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: electionStatusTone[election.status] }} />
              {electionStatusLabel[election.status]}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs" style={{ color: "var(--text-muted)" }}>
            已 {summary.total_votes}・有效 {summary.valid_votes}・廢 {summary.invalid_votes}・應選 {summary.seats} 名
            {summary.turnout_pct !== null && `・投票率 ${summary.turnout_pct}%`}
            {summary.vote_threshold_pct !== null && `・門檻 ${summary.vote_threshold_pct}%`}
          </p>
        </div>
        <GovernanceLinkPanel
          entityType="election"
          entityId={election.id}
          title={election.title}
          href={`/admin/elections/${election.id}/count`}
          compact
        />
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {electionActions.map((item) => (
            <button key={item.status} disabled={busy} className="btn btn-primary btn-sm" onClick={() => run(() => electionsApi.updateStatus(id, item.status), item.label)}>
              {item.label}
            </button>
          ))}
          <Link className="btn btn-secondary btn-sm" target="_blank" href={`/live/elections/${shareRef}`} aria-label="公開看板">
            <Monitor size={15} />
          </Link>
          <Link className="btn btn-secondary btn-sm" target="_blank" href={`/live/elections/${shareRef}/vertical`} aria-label="IG 直式版">
            <Smartphone size={15} />
          </Link>
          <button className="btn btn-secondary btn-sm" onClick={copyShareLink} aria-label="複製分享連結">
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setLogOpen(true)}>
            <History size={15} /> 紀錄
          </button>
        </div>
      </header>

      <section className="shrink-0 card flex flex-wrap items-center gap-x-3 gap-y-2 p-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {election.ballot_boxes.map((box) => {
            const active = box.id === boxId;
            return (
              <button
                key={box.id}
                onClick={() => setBoxId(box.id)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors"
                style={{
                  borderColor: active ? "var(--primary)" : "var(--border)",
                  background: active ? "var(--primary-dim)" : "var(--bg-elevated)",
                }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: boxStatusTone[box.status] }} />
                <span className="font-medium">{box.name}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{boxStatusLabel[box.status]}</span>
              </button>
            );
          })}
        </div>
        {selectedBox && selectedBox.status !== "locked" && (
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {(["counting", "paused", "locked"] as BallotBoxStatus[]).map((status) => (
              <button
                key={status}
                disabled={busy || selectedBox.status === status}
                className="btn btn-secondary btn-sm"
                onClick={() => run(() => electionsApi.updateBallotBoxStatus(id, selectedBox.id, status))}
              >
                {status === "counting" ? "開始／恢復" : status === "paused" ? "暫停票匭" : "鎖定"}
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="lock-guard min-h-0 flex-1 overflow-auto" data-locked={!canCount}>
        {!canCount && (
          <div className="lock-guard-veil">
            <div className="max-w-sm">
              <Lock className="mx-auto mb-2" size={26} style={{ color: "var(--danger)" }} />
              <p className="font-semibold" style={{ color: "var(--danger)" }}>目前無法記票</p>
              <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{lockReason}</p>
            </div>
          </div>
        )}
        <div
          className={`lock-guard-content grid min-h-full gap-3 ${colClass}`}
          style={{ gridAutoRows: "minmax(9.5rem, 1fr)" }}
        >
          {election.candidates.map((candidate) => {
            const tally = summary.candidates.find((item) => item.candidate_id === candidate.id);
            const votes = tally?.votes ?? 0;
            return (
              <article key={candidate.id} className="card relative flex min-h-0 flex-col gap-2 overflow-hidden p-3">
                <div className="flex items-center gap-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg font-bold text-white" style={{ background: candidate.color }}>{candidate.number}</span>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    {candidate.members.filter((member) => member.photo_url).slice(0, 3).map((member) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={member.id}
                        src={uploadUrl(member.photo_url)}
                        alt={member.name}
                        className="h-7 w-7 shrink-0 rounded-full object-cover"
                        style={{ border: "1px solid var(--border)" }}
                      />
                    ))}
                    <p className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
                      {candidate.members.length > 0 ? memberNames(candidate.members) : candidate.name}
                    </p>
                  </div>
                  <span
                    key={votes}
                    className="live-vote-bump shrink-0 text-2xl font-black tabular-nums sm:text-3xl"
                    style={{ color: votes > 0 ? candidate.color : "var(--text-primary)" }}
                  >
                    {votes}
                  </span>
                </div>
                {renderControls(candidate.id, "candidate", candidate.id)}
                {renderManual(candidate.id, candidate.id, "candidate")}
              </article>
            );
          })}

          <article className="card relative flex min-h-0 flex-col gap-2 overflow-hidden p-3">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-sm">廢票／無效票</strong>
              <span key={summary.invalid_votes} className="live-vote-bump shrink-0 text-2xl font-black tabular-nums sm:text-3xl">{summary.invalid_votes}</span>
            </div>
            {renderControls(null, "invalid", "invalid")}
            {renderManual("invalid", null, "invalid")}
          </article>
        </div>
      </div>

      {logOpen && (
        <>
          <button
            className="fixed inset-0 z-40 bg-black/40"
            aria-label="關閉紀錄"
            onClick={() => setLogOpen(false)}
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l p-4 shadow-2xl" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
            <div className="flex shrink-0 items-center justify-between">
              <h2 className="font-semibold">最近操作紀錄</h2>
              <button className="btn btn-ghost btn-sm" aria-label="關閉" onClick={() => setLogOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-auto">
              {events.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚無操作紀錄</p>}
              {events.map((event) => (
                <div key={event.id} className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">
                      {event.candidate_name ?? "廢票"}{" "}
                      <span style={{ color: event.delta > 0 ? "var(--success)" : "var(--danger)" }}>
                        {event.delta > 0 ? "+" : ""}{event.delta}
                      </span>
                    </span>
                    {!event.reverses_event_id && (
                      <button className="inline-flex items-center gap-1 text-xs underline" disabled={busy} onClick={() => run(() => electionsApi.reverseEvent(id, event.id), "已撤銷操作")}>
                        <Undo2 size={12} /> 撤銷
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {event.ballot_box_name} · {event.operator_name} · {new Date(event.created_at).toLocaleTimeString("zh-TW")}
                  </p>
                </div>
              ))}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
