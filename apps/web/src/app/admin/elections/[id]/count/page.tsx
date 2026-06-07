"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { electionsApi } from "@/lib/api";
import type {
  BallotBoxStatus,
  ElectionLiveSummary,
  ElectionOut,
  ElectionStatus,
  VoteEventKind,
  VoteEventOut,
} from "@/lib/types";

export default function ElectionCountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [election, setElection] = useState<ElectionOut | null>(null);
  const [summary, setSummary] = useState<ElectionLiveSummary | null>(null);
  const [events, setEvents] = useState<VoteEventOut[]>([]);
  const [boxId, setBoxId] = useState("");
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

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

  if (!election || !summary) return <div className="card p-8">載入控制台中…</div>;

  const selectedBox = election.ballot_boxes.find((box) => box.id === boxId);
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
        <div>
          <h1 className="text-2xl font-bold">{election.title}</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            已記錄 {summary.total_votes} 票，廢票 {summary.invalid_votes} 票
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="btn btn-secondary" target="_blank" href={`/live/elections/${id}`}>公開看板</Link>
          <Link className="btn btn-secondary" target="_blank" href={`/live/elections/${id}/vertical`}>IG 直式版</Link>
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
              {election.ballot_boxes.map((box) => (
                <button
                  key={box.id}
                  onClick={() => setBoxId(box.id)}
                  className="rounded-xl border p-4 text-left"
                  style={{
                    borderColor: box.id === boxId ? "var(--primary)" : "var(--border)",
                    background: box.id === boxId ? "var(--primary-dim)" : "var(--bg-elevated)",
                  }}
                >
                  <strong>{box.name}</strong>
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{box.status}</p>
                </button>
              ))}
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

          <section className="grid md:grid-cols-2 gap-4">
            {election.candidates.map((candidate) => {
              const tally = summary.candidates.find((item) => item.candidate_id === candidate.id);
              return (
                <article key={candidate.id} className="card p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="h-10 w-10 rounded-xl grid place-items-center text-white font-bold" style={{ background: candidate.color }}>{candidate.number}</span>
                      <div>
                        {candidate.members.length > 0 ? candidate.members.map((member) => (
                          <p key={member.id}>
                            <span className="text-sm" style={{ color: "var(--text-muted)" }}>{member.position}</span>
                            <strong className="ml-2">{member.name}</strong>
                          </p>
                        )) : <strong>{candidate.name}</strong>}
                      </div>
                    </div>
                    <span className="text-3xl font-black tabular-nums">{tally?.votes ?? 0}</span>
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
                <span className="text-3xl font-black">{summary.invalid_votes}</span>
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

        <aside className="card p-5 self-start xl:sticky xl:top-5">
          <h2 className="font-semibold">最近操作紀錄</h2>
          <div className="mt-4 space-y-3 max-h-[70vh] overflow-auto">
            {events.map((event) => (
              <div key={event.id} className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{event.candidate_name ?? "廢票"} {event.delta > 0 ? "+" : ""}{event.delta}</span>
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
