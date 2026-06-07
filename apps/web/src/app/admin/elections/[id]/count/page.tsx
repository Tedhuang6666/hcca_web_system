"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { Check, Copy, Lock, Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { electionsApi } from "@/lib/api";
import { uploadUrl } from "@/lib/config";
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

export default function ElectionCountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [election, setElection] = useState<ElectionOut | null>(null);
  const [summary, setSummary] = useState<ElectionLiveSummary | null>(null);
  const [events, setEvents] = useState<VoteEventOut[]>([]);
  const [boxId, setBoxId] = useState("");
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
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
      ? "選舉尚未開始，請先按右上角「開始開票」"
      : election.status === "paused"
        ? "全場開票已暫停，請先按「恢復開票」"
        : election.status === "closed"
          ? "選舉已結束，票數已封存"
          : !selectedBox
            ? "請先於上方選擇票匭"
            : selectedBox.status !== "counting"
              ? `「${selectedBox.name}」目前${boxStatusLabel[selectedBox.status]}，請先按「開始／恢復此票匭」`
              : "";

  const electionActions: { status: ElectionStatus; label: string }[] =
    election.status === "draft"
      ? [{ status: "live", label: "開始開票" }]
      : election.status === "live"
        ? [{ status: "paused", label: "暫停全部" }, { status: "closed", label: "結束選舉" }]
        : election.status === "paused"
          ? [{ status: "live", label: "恢復開票" }, { status: "closed", label: "結束選舉" }]
          : [];

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{election.title}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            已記錄 {summary.total_votes} 票，有效 {summary.valid_votes} 票，廢票 {summary.invalid_votes} 票
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            應選 {summary.seats} 名
            {summary.turnout_pct !== null && `　·　投票率 ${summary.turnout_pct}%${summary.turnout_threshold_pct !== null ? `／門檻 ${summary.turnout_threshold_pct}%（${summary.turnout_met ? "已達" : "未達"}）` : ""}`}
            {summary.vote_threshold_pct !== null && `　·　得票率門檻 ${summary.vote_threshold_pct}%`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code
              className="rounded-md px-2 py-1 text-xs"
              style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}
            >
              /live/elections/{decodeURIComponent(shareRef)}
            </code>
            <button className="btn btn-secondary btn-sm" onClick={copyShareLink}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "已複製" : "複製分享連結"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn btn-secondary" target="_blank" href={`/live/elections/${shareRef}`}>
            <Monitor size={15} /> 公開看板
          </Link>
          <Link className="btn btn-secondary" target="_blank" href={`/live/elections/${shareRef}/vertical`}>
            <Smartphone size={15} /> IG 直式版
          </Link>
          {electionActions.map((item) => (
            <button key={item.status} disabled={busy} className="btn btn-primary" onClick={() => run(() => electionsApi.updateStatus(id, item.status), item.label)}>
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid xl:grid-cols-[1fr_360px] gap-5">
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="font-semibold mb-3">票匭控制</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {election.ballot_boxes.map((box) => {
                const active = box.id === boxId;
                return (
                  <button
                    key={box.id}
                    onClick={() => setBoxId(box.id)}
                    className="rounded-xl border p-4 text-left transition-transform hover:-translate-y-0.5"
                    style={{
                      borderColor: active ? "var(--primary)" : "var(--border)",
                      background: active ? "var(--primary-dim)" : "var(--bg-elevated)",
                      boxShadow: active ? "var(--shadow-md)" : "none",
                    }}
                  >
                    <strong>{box.name}</strong>
                    <p className="mt-1 flex items-center gap-1.5 text-xs font-medium" style={{ color: boxStatusTone[box.status] }}>
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: boxStatusTone[box.status] }} />
                      {boxStatusLabel[box.status]}
                    </p>
                  </button>
                );
              })}
            </div>
            {selectedBox && selectedBox.status !== "locked" && (
              <div className="flex flex-wrap gap-2 mt-4">
                {(["counting", "paused", "locked"] as BallotBoxStatus[]).map((status) => (
                  <button
                    key={status}
                    disabled={busy || selectedBox.status === status}
                    className="btn btn-secondary"
                    onClick={() => run(() => electionsApi.updateBallotBoxStatus(id, selectedBox.id, status))}
                  >
                    {status === "counting" ? "開始／恢復此票匭" : status === "paused" ? "暫停此票匭" : "鎖定結果"}
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="lock-guard" data-locked={!canCount}>
            {!canCount && (
              <div className="lock-guard-veil">
                <div className="max-w-sm">
                  <Lock className="mx-auto mb-2" size={26} style={{ color: "var(--danger)" }} />
                  <p className="font-semibold" style={{ color: "var(--danger)" }}>目前無法記票</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{lockReason}</p>
                </div>
              </div>
            )}
            <section className="lock-guard-content grid md:grid-cols-2 gap-4">
              {election.candidates.map((candidate) => {
                const tally = summary.candidates.find((item) => item.candidate_id === candidate.id);
                const votes = tally?.votes ?? 0;
                return (
                  <article key={candidate.id} className="card p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl font-bold text-white" style={{ background: candidate.color }}>{candidate.number}</span>
                        <div className="min-w-0">
                          {candidate.members.length > 0 ? candidate.members.map((member) => (
                            <p key={member.id} className="flex items-center gap-2">
                              {member.photo_url && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={uploadUrl(member.photo_url)}
                                  alt={member.name}
                                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                                  style={{ border: "1px solid var(--border)" }}
                                />
                              )}
                              <span className="text-sm" style={{ color: "var(--text-muted)" }}>{member.position}</span>
                              <strong>{member.name}</strong>
                            </p>
                          )) : <strong>{candidate.name}</strong>}
                        </div>
                      </div>
                      <span
                        key={votes}
                        className="live-vote-bump text-3xl font-black tabular-nums"
                        style={{ color: votes > 0 ? candidate.color : "var(--text-primary)" }}
                      >
                        {votes}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-5">
                      {[1, 5, 10].map((amount) => (
                        <button key={amount} disabled={busy} className="btn btn-primary" onClick={() => addVote(candidate.id, amount, "candidate")}>+{amount}</button>
                      ))}
                      <button disabled={busy} className="btn btn-secondary" onClick={() => addVote(candidate.id, -1, "candidate")}>-1</button>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <input
                        type="number"
                        step={1}
                        className="input flex-1"
                        placeholder="手動輸入，例如 23 或 -2"
                        value={manualValues[candidate.id] ?? ""}
                        onChange={(event) => setManualValues((values) => ({ ...values, [candidate.id]: event.target.value }))}
                      />
                      <button className="btn btn-secondary" disabled={busy} onClick={() => submitManual(candidate.id, candidate.id, "candidate")}>記錄</button>
                    </div>
                  </article>
                );
              })}
              <article className="card p-5">
                <div className="flex justify-between">
                  <strong>廢票／無效票</strong>
                  <span key={summary.invalid_votes} className="live-vote-bump text-3xl font-black tabular-nums">{summary.invalid_votes}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-5">
                  {[1, 5, 10].map((amount) => (
                    <button key={amount} disabled={busy} className="btn btn-primary" onClick={() => addVote(null, amount, "invalid")}>+{amount}</button>
                  ))}
                  <button disabled={busy} className="btn btn-secondary" onClick={() => addVote(null, -1, "invalid")}>-1</button>
                </div>
                <div className="flex gap-2 mt-2">
                  <input
                    type="number"
                    step={1}
                    className="input flex-1"
                    placeholder="手動輸入廢票異動"
                    value={manualValues.invalid ?? ""}
                    onChange={(event) => setManualValues((values) => ({ ...values, invalid: event.target.value }))}
                  />
                  <button className="btn btn-secondary" disabled={busy} onClick={() => submitManual("invalid", null, "invalid")}>記錄</button>
                </div>
              </article>
            </section>
          </div>
        </div>

        <aside className="card p-5 self-start xl:sticky xl:top-5">
          <h2 className="font-semibold">最近操作紀錄</h2>
          <div className="mt-4 space-y-3 max-h-[70vh] overflow-auto">
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
                    <button className="text-xs underline" disabled={busy} onClick={() => run(() => electionsApi.reverseEvent(id, event.id), "已撤銷操作")}>撤銷</button>
                  )}
                </div>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {event.ballot_box_name} · {event.operator_name} · {new Date(event.created_at).toLocaleTimeString("zh-TW")}
                </p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
