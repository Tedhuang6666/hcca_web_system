"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileText, Monitor, Paperclip, Radio, Settings } from "lucide-react";
import { meetingsApi } from "@/lib/api";
import type { MeetingOut } from "@/lib/types";

const WORKFLOW_LABEL: Record<string, string> = {
  draft: "草稿",
  under_review: "送審中",
  scheduled: "已排入議程",
  council_approved: "議會核定",
  published: "已公布",
  rejected: "已退回",
  archived: "已廢止",
};
const AMENDMENT_LABEL: Record<string, string> = { enact: "制定", amend: "修正", abolish: "廢止" };
const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  active: "進行中",
  paused: "暫停",
  closed: "已結束",
};

export default function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [meeting, setMeeting] = useState<MeetingOut | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void params.then(({ id: nextId }) => setId(nextId));
  }, [params]);

  useEffect(() => {
    if (!id) return;
    meetingsApi.get(id).then(setMeeting).catch((err) => {
      setError(err instanceof Error ? err.message : "載入會議失敗");
    });
  }, [id]);

  const screenHref = useMemo(
    () => (meeting ? `/meetings/screen/${meeting.screen_token}` : "#"),
    [meeting],
  );

  if (error) return <main className="p-6 text-sm text-red-500">{error}</main>;
  if (!meeting) return <main className="p-6 text-sm text-[var(--muted)]">載入中...</main>;

  const current = meeting.agenda_items.find((item) => item.id === meeting.current_agenda_item_id);
  const isDraft = meeting.status === "draft";
  const agenda = [...meeting.agenda_items].sort((a, b) => a.order_index - b.order_index);

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">{meeting.title}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {STATUS_LABEL[meeting.status]} · {meeting.location || "未填地點"} · 主席{" "}
            {meeting.chair_name || "未填"}
            {meeting.starts_at && ` · ${new Date(meeting.starts_at).toLocaleString()}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isDraft && (
            <Link
              href={`/meetings/${meeting.id}/edit`}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <Settings size={16} aria-hidden="true" />
              會議設定
            </Link>
          )}
          <Link
            href={`/meetings/${meeting.id}/control`}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            <Radio size={16} aria-hidden="true" />
            遙控控制台
          </Link>
          <Link
            href={screenHref}
            target="_blank"
            className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-black">
            <Monitor size={16} aria-hidden="true" />
            開啟公開大屏
          </Link>
        </div>
      </div>

      {isDraft && (
        <section className="mb-5 rounded-lg border border-[var(--border)] p-4 text-sm">
          {meeting.confirmed_at ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2 text-emerald-500">
                <CheckCircle2 size={16} aria-hidden="true" />
                議程已確認，等待主席開始會議
              </span>
              {meeting.notice_document_id && (
                <Link
                  href={`/documents/${meeting.notice_document_id}`}
                  className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-1.5">
                  <FileText size={14} aria-hidden="true" />
                  開會通知單
                </Link>
              )}
            </div>
          ) : (
            <p className="text-[var(--muted)]">
              此會議仍為草稿。請至「會議設定」完成基本設定與議程，並確認後產生開會通知單。
            </p>
          )}
        </section>
      )}

      <section className="mb-5 rounded-lg border border-[var(--border)] p-4">
        <p className="text-xs font-medium text-[var(--muted)]">目前議案</p>
        <h2 className="mt-1 text-xl font-semibold">{current?.title || "尚未選定議案"}</h2>
        {current?.description && <p className="mt-2 whitespace-pre-wrap text-sm">{current.description}</p>}
      </section>

      <section className="rounded-lg border border-[var(--border)] p-4">
        <h2 className="mb-3 text-lg font-semibold">議程</h2>
        <div className="grid gap-2">
          {agenda.map((item, index) => (
            <div key={item.id} className="rounded-md border border-[var(--border)] p-3">
              <p className="text-sm font-medium">
                {index + 1}. {item.title}
              </p>
              {item.regulation && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                  <span className="rounded bg-[var(--border)] px-1.5 py-0.5">
                    {AMENDMENT_LABEL[item.regulation.amendment_type]}案
                  </span>
                  <Link href={`/regulations/${item.regulation.id}`} className="hover:underline">
                    {item.regulation.title}
                  </Link>
                  <span>· {WORKFLOW_LABEL[item.regulation.workflow_status]}</span>
                </p>
              )}
              {item.description && (
                <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">{item.description}</p>
              )}
              {item.resolution && (
                <p className="mt-1 text-xs text-emerald-500">決議：{item.resolution}</p>
              )}
              {item.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.attachments.map((attachment) => {
                    const href =
                      attachment.link_url ||
                      meetingsApi.agendaAttachmentDownloadUrl(meeting.id, item.id, attachment.id);
                    return (
                      <a
                        key={attachment.id}
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:underline">
                        <Paperclip size={12} aria-hidden="true" />
                        <span className="truncate">
                          {attachment.display_name || attachment.filename}
                        </span>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {agenda.length === 0 && (
            <p className="text-sm text-[var(--muted)]">尚未建立議程。</p>
          )}
        </div>
      </section>
    </main>
  );
}
