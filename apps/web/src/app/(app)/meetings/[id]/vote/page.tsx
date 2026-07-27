"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, FileText, Home, MessageSquare, Vote } from "lucide-react";
import { meetingsApi } from "@/lib/api";
import { useWS } from "@/hooks/useWS";
import type { BallotChoice, MeetingOut, MeetingScreenOut } from "@/lib/types";

export default function MeetingVotePage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [meeting, setMeeting] = useState<MeetingOut | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void params.then(({ id: nextId }) => setId(nextId));
  }, [params]);

  const load = useCallback(async () => {
    if (!id) return;
    setMeeting(await meetingsApi.get(id));
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

  const openVote = meeting?.votes.find((vote) => vote.status === "open") ?? null;
  const current = meeting?.agenda_items.find((item) => item.id === meeting.current_agenda_item_id);

  async function cast(choice: BallotChoice) {
    if (!meeting || !openVote) return;
    try {
      await meetingsApi.castBallot(meeting.id, openVote.id, choice);
      setMessage("投票已送出");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "投票失敗");
    }
  }

  if (!meeting) return <main className="p-6 text-sm text-[var(--muted)]">載入中...</main>;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-5">
      <nav className="mb-5 grid grid-cols-4 gap-2">
        <Link href="/" className="flex flex-col items-center gap-1 rounded-md border border-[var(--border)] px-2 py-2 text-xs">
          <Home size={16} aria-hidden="true" />
          首頁
        </Link>
        <Link href="/regulations" className="flex flex-col items-center gap-1 rounded-md border border-[var(--border)] px-2 py-2 text-xs">
          <BookOpen size={16} aria-hidden="true" />
          法規
        </Link>
        <Link href="/documents" className="flex flex-col items-center gap-1 rounded-md border border-[var(--border)] px-2 py-2 text-xs">
          <FileText size={16} aria-hidden="true" />
          公文
        </Link>
        <Link href={`/meetings/${meeting.id}`} className="flex flex-col items-center gap-1 rounded-md border border-[var(--border)] px-2 py-2 text-xs">
          <Vote size={16} aria-hidden="true" />
          會議
        </Link>
      </nav>

      <h1 className="text-2xl font-semibold tracking-normal">{meeting.title}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">議員現場工作台，可隨時切回平台其他功能。</p>

      <button
        onClick={async () => {
          try {
            await meetingsApi.checkIn(meeting.id);
            setMessage("已完成報到");
            await load();
          } catch (err) {
            setMessage(err instanceof Error ? err.message : "報到失敗");
          }
        }}
        className="mt-6 rounded-md border border-[var(--border)] px-4 py-3 text-sm">
        報到
      </button>

      <section className="mt-6 rounded-lg border border-[var(--border)] p-4">
        <p className="text-xs font-medium text-[var(--muted)]">目前議案</p>
        <h2 className="mt-1 text-xl font-semibold">{current?.title || "尚未選定議案"}</h2>
        {current?.description && <p className="mt-2 whitespace-pre-wrap text-sm">{current.description}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {current?.regulation_id && (
            <Link href={`/regulations/${current.regulation_id}`} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              查看關聯法規
            </Link>
          )}
          {current?.document_id && (
            <Link href={`/documents/${current.document_id}`} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              查看關聯公文
            </Link>
          )}
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-[var(--border)] p-4">
        {openVote ? (
          <>
            <p className="text-xs font-medium text-[var(--muted)]">進行中表決</p>
            <h2 className="mt-1 text-xl font-semibold">{openVote.title}</h2>
            {openVote.description && <p className="mt-2 text-sm">{openVote.description}</p>}
            <div className="mt-5 grid gap-2">
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
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">目前沒有開啟中的表決。</p>
        )}
      </section>

      <section className="mt-4 rounded-lg border border-[var(--border)] p-4">
        <h2 className="text-lg font-semibold">現場請求</h2>
        <div className="mt-3 grid gap-2">
          <button
            onClick={() => runRequest("speech")}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-3 text-sm">
            <MessageSquare size={16} aria-hidden="true" />
            請求發言
          </button>
          <button
            onClick={() => runRequest("point_of_order")}
            className="rounded-md border border-[var(--border)] px-4 py-3 text-sm">
            秩序問題
          </button>
          <button
            onClick={() => runRequest("privilege")}
            className="rounded-md border border-[var(--border)] px-4 py-3 text-sm">
            權宜問題
          </button>
        </div>
      </section>

      {message && <p className="mt-4 text-sm">{message}</p>}
    </main>
  );

  async function runRequest(requestType: "speech" | "point_of_order" | "privilege") {
    if (!meeting) return;
    try {
      await meetingsApi.createRequest(meeting.id, {
        request_type: requestType,
        agenda_item_id: meeting.current_agenda_item_id,
      });
      setMessage("請求已送出");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "送出請求失敗");
    }
  }
}
