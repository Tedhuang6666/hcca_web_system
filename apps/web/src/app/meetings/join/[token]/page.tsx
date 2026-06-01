"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, BookOpen, CheckCircle2, FileText, Hand, MessageSquare, Shield } from "lucide-react";
import { meetingsApi } from "@/lib/api";
import { useWS } from "@/hooks/useWS";
import type { BallotChoice, MeetingJoinOut, MeetingRequestType, MeetingScreenOut } from "@/lib/types";

const REQUEST_LABEL: Record<MeetingRequestType, string> = {
  speech: "請求發言",
  point_of_order: "秩序問題",
  privilege: "權宜問題",
};

const CHOICE_LABEL: Record<BallotChoice, string> = {
  approve: "同意",
  reject: "不同意",
  abstain: "廢票 / 棄權",
};

export default function MeetingJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [payload, setPayload] = useState<MeetingJoinOut | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    void params.then(({ token: nextToken }) => setToken(nextToken));
  }, [params]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setPayload(await meetingsApi.join(token));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入會議入口失敗");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [load, token]);

  useWS(
    payload?.meeting.id ? `meeting:${payload.meeting.id}` : null,
    (msg) => {
      const data = msg.data as MeetingScreenOut | undefined;
      if (data?.meeting) void load();
    },
    Boolean(payload?.meeting.id),
  );

  async function checkIn() {
    if (!payload) return;
    setBusyAction("check-in");
    try {
      await meetingsApi.checkIn(payload.meeting.id, token);
      setMessage("已完成報到");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "報到失敗");
    } finally {
      setBusyAction(null);
    }
  }

  async function cast(choice: BallotChoice) {
    if (!payload?.active_vote) return;
    setBusyAction(`vote-${choice}`);
    try {
      await meetingsApi.castBallot(payload.meeting.id, payload.active_vote.id, choice);
      setMessage("投票已送出");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "投票失敗");
    } finally {
      setBusyAction(null);
    }
  }

  async function createRequest(request_type: MeetingRequestType) {
    if (!payload) return;
    setBusyAction(`request-${request_type}`);
    try {
      await meetingsApi.createRequest(payload.meeting.id, {
        request_type,
        agenda_item_id: payload.current_agenda_item?.id ?? null,
      });
      setMessage(`${REQUEST_LABEL[request_type]}已送出`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "送出請求失敗");
    } finally {
      setBusyAction(null);
    }
  }

  if (error) return <main className="p-6 text-sm text-red-500">{error}</main>;
  if (!payload) return <main className="p-6 text-sm text-[var(--muted)]">載入會議入口...</main>;

  const { meeting, current_agenda_item: current, active_vote: activeVote } = payload;
  const attendance = payload.attendance;
  const hasCheckedIn = attendance?.status === "present";
  const votedChoice = payload.my_ballot?.choice ?? null;
  const canCast = Boolean(activeVote && payload.can_vote && !votedChoice);
<<<<<<< HEAD
  const myQueue = payload.my_speech_queue_items ?? [];
  const activeSpeech = payload.active_speech;
=======
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 px-5 py-5">
      <header>
<<<<<<< HEAD
        <p className="text-xs font-medium text-[var(--muted)]">議員現場入口</p>
=======
        <p className="text-xs font-medium text-[var(--muted)]">現場工作台</p>
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
        <h1 className="mt-1 text-2xl font-semibold tracking-normal">{meeting.title}</h1>
        <div className="mt-3 grid gap-2 text-sm">
          <span className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2">
            <CheckCircle2 size={16} aria-hidden="true" />
            {hasCheckedIn ? "已報到" : "尚未報到"}
          </span>
          <span className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2">
            <Shield size={16} aria-hidden="true" />
            {attendance?.is_voting_eligible
              ? `表決權：${attendance.voting_class?.label || attendance.voting_class?.class_code || "未分班"}`
              : payload.is_rostered
                ? "列席，無表決權"
                : "旁聽，未列入名冊"}
          </span>
        </div>
      </header>

      <button
        onClick={checkIn}
        disabled={busyAction === "check-in"}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 py-3 text-base font-semibold text-black hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]">
        <CheckCircle2 size={16} aria-hidden="true" />
        {busyAction === "check-in" ? "報到中..." : hasCheckedIn ? "重新同步現場狀態" : "報到並進入會議"}
      </button>

      <section className="rounded-lg border border-[var(--border)] p-4">
<<<<<<< HEAD
        <p className="text-xs font-medium text-[var(--muted)]">目前發言</p>
        <h2 className="mt-1 text-xl font-semibold">
          {activeSpeech?.speaker_name || "尚未開始發言"}
        </h2>
        {activeSpeech?.speaker_role && (
          <p className="mt-1 text-sm text-[var(--muted)]">{activeSpeech.speaker_role}</p>
        )}
        <div className="mt-3 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
          {myQueue.length > 0 ? (
            <div className="space-y-1">
              {myQueue.map((item, index) => (
                <p key={item.id}>
                  我的發言 #{index + 1}：{item.status === "queued" ? "排隊中" : item.status}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-[var(--muted)]">你目前沒有排隊發言。</p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] p-4">
=======
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
        <p className="text-xs font-medium text-[var(--muted)]">目前議程</p>
        <h2 className="mt-1 text-xl font-semibold">{current?.title || "尚未選定議程"}</h2>
        {current?.description && <p className="mt-2 whitespace-pre-wrap text-sm">{current.description}</p>}
        <div className="mt-4 grid gap-2">
          {current?.regulation_id && (
            <Link
              href={`/regulations/${current.regulation_id}`}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <BookOpen size={15} aria-hidden="true" />
              查看關聯法規
            </Link>
          )}
          {current?.document_id && (
            <Link
              href={`/documents/${current.document_id}`}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <FileText size={15} aria-hidden="true" />
              查看關聯公文
            </Link>
          )}
          {current?.attachments.map((attachment) => (
            <a
              key={attachment.id}
              href={
                attachment.link_url ||
                meetingsApi.agendaAttachmentDownloadUrl(meeting.id, current.id, attachment.id)
              }
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              {attachment.display_name || attachment.filename}
            </a>
          ))}
          {current?.artifact_links.map((link) => (
            <a
              key={link.id}
              href={link.url || "#"}
              target={link.url ? "_blank" : undefined}
              rel="noreferrer"
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              {link.title}
            </a>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] p-4">
        <h2 className="text-lg font-semibold">表決</h2>
        {activeVote ? (
          <div className="mt-3 grid gap-2">
            <p className="text-sm font-medium">{activeVote.title}</p>
            {activeVote.description && (
              <p className="whitespace-pre-wrap text-sm text-[var(--muted)]">{activeVote.description}</p>
            )}
            {votedChoice && (
              <p role="alert" className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-700">
                已投票：{CHOICE_LABEL[votedChoice]}。表決關閉前不可重複送出。
              </p>
            )}
            {!payload.can_vote && (
              <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
                你不是本場已報到的表決權人，因此不能投票。
              </p>
            )}
            <button
              disabled={!canCast}
              onClick={() => cast("approve")}
              className="rounded-md bg-green-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
              {busyAction === "vote-approve" ? "送出中..." : "同意"}
            </button>
            <button
              disabled={!canCast}
              onClick={() => cast("reject")}
              className="rounded-md bg-red-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
              {busyAction === "vote-reject" ? "送出中..." : "不同意"}
            </button>
            <button
              disabled={!canCast}
              onClick={() => cast("abstain")}
              className="rounded-md border border-[var(--border)] px-4 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-45">
              {busyAction === "vote-abstain" ? "送出中..." : "廢票 / 棄權"}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">目前沒有可投票的表決。</p>
        )}
      </section>

      <section className="rounded-lg border border-[var(--border)] p-4">
        <h2 className="text-lg font-semibold">現場請求</h2>
        <div className="mt-3 grid gap-2">
          <button
            onClick={() => createRequest("speech")}
            disabled={busyAction === "request-speech"}
<<<<<<< HEAD
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-black">
=======
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-3 text-sm">
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
            <MessageSquare size={16} aria-hidden="true" />
            {busyAction === "request-speech" ? "送出中..." : "請求發言"}
          </button>
          <button
            onClick={() => createRequest("point_of_order")}
            disabled={busyAction === "request-point_of_order"}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-3 text-sm">
            <AlertCircle size={16} aria-hidden="true" />
            {busyAction === "request-point_of_order" ? "送出中..." : "秩序問題"}
          </button>
          <button
            onClick={() => createRequest("privilege")}
            disabled={busyAction === "request-privilege"}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-3 text-sm">
            <Hand size={16} aria-hidden="true" />
            {busyAction === "request-privilege" ? "送出中..." : "權宜問題"}
          </button>
        </div>
      </section>

      {message && <p role="alert" className="text-sm" aria-live="polite">{message}</p>}
    </main>
  );
}
