"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, FileText, MessageSquare } from "lucide-react";
import { meetingsApi } from "@/lib/api";
import type { BallotChoice, MeetingJoinOut } from "@/lib/types";

export default function MeetingJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [payload, setPayload] = useState<MeetingJoinOut | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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

  async function checkIn() {
    if (!payload) return;
    try {
      await meetingsApi.checkIn(payload.meeting.id, token);
      setMessage("已完成報到");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "報到失敗");
    }
  }

  async function cast(choice: BallotChoice) {
    if (!payload?.active_vote) return;
    try {
      await meetingsApi.castBallot(payload.meeting.id, payload.active_vote.id, choice);
      setMessage("投票已送出");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "投票失敗");
    }
  }

  async function requestSpeech() {
    if (!payload) return;
    try {
      await meetingsApi.createRequest(payload.meeting.id, {
        request_type: "speech",
        agenda_item_id: payload.current_agenda_item?.id ?? null,
      });
      setMessage("請求已送出");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "送出請求失敗");
    }
  }

  if (error) return <main className="p-6 text-sm text-red-500">{error}</main>;
  if (!payload) return <main className="p-6 text-sm text-[var(--muted)]">載入會議入口...</main>;

  const { meeting, current_agenda_item: current, active_vote: activeVote } = payload;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-5">
      <h1 className="text-2xl font-semibold tracking-normal">{meeting.title}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {payload.is_rostered ? "你已在本場名冊中" : "你目前不在名冊，將以旁聽視角瀏覽"}
      </p>

      <button
        onClick={checkIn}
        className="mt-5 inline-flex items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 py-3 text-sm font-medium text-black">
        <CheckCircle2 size={16} aria-hidden="true" />
        報到並進入會議
      </button>

      <section className="mt-5 rounded-lg border border-[var(--border)] p-4">
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

      <section className="mt-4 rounded-lg border border-[var(--border)] p-4">
        <h2 className="text-lg font-semibold">表決與發言</h2>
        {activeVote && payload.can_vote ? (
          <div className="mt-3 grid gap-2">
            <p className="text-sm font-medium">{activeVote.title}</p>
            <button onClick={() => cast("approve")} className="rounded-md bg-green-600 px-4 py-3 text-white">
              同意
            </button>
            <button onClick={() => cast("reject")} className="rounded-md bg-red-600 px-4 py-3 text-white">
              反對
            </button>
            <button onClick={() => cast("abstain")} className="rounded-md border border-[var(--border)] px-4 py-3">
              棄權
            </button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">目前沒有可投票的表決。</p>
        )}
        <button
          onClick={requestSpeech}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-3 text-sm">
          <MessageSquare size={16} aria-hidden="true" />
          請求發言
        </button>
      </section>

      {message && <p className="mt-4 text-sm">{message}</p>}
    </main>
  );
}
