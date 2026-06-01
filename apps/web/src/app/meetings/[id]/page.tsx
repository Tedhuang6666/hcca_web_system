import type { Metadata } from "next";
import { cookies } from "next/headers";

<<<<<<< HEAD
import { serverApiUrl } from "@/lib/config";
import { JsonLd, absoluteUrl, excerpt, pageMetadata } from "@/lib/seo";
=======
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  FileText,
  Monitor,
  Paperclip,
  Pause,
  Play,
  Radio,
  Settings,
  Square,
} from "lucide-react";
import { meetingsApi } from "@/lib/api";
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
import type { MeetingMinutesOut, MeetingOut } from "@/lib/types";

import MeetingDetailPageClient from "./MeetingDetailPageClient";

<<<<<<< HEAD
async function authHeaders() {
  const cookie = (await cookies()).toString();
  return cookie ? { Cookie: cookie } : undefined;
}
=======
export default function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [meeting, setMeeting] = useState<MeetingOut | null>(null);
  const [minutes, setMinutes] = useState<MeetingMinutesOut | null>(null);
  const [error, setError] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const runStatus = async (action: () => Promise<MeetingOut>) => {
    setStatusBusy(true);
    setError("");
    try {
      setMeeting(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失敗");
    } finally {
      setStatusBusy(false);
    }
  };
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71

async function fetchMeeting(id: string): Promise<MeetingOut | null> {
  const res = await fetch(serverApiUrl(`/meetings/${encodeURIComponent(id)}`), {
    headers: await authHeaders(),
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchMinutes(id: string): Promise<MeetingMinutesOut | null> {
  const res = await fetch(serverApiUrl(`/meetings/${encodeURIComponent(id)}/minutes`), {
    headers: await authHeaders(),
  });
  if (!res.ok) return null;
  return res.json();
}

<<<<<<< HEAD
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const meeting = await fetchMeeting(id);
  const title = meeting?.title ?? "會議紀錄";
  const description = excerpt(
    meeting?.description ?? meeting?.screen_focus_body,
    "班聯會會議資訊與會議紀錄。",
  );

  return pageMetadata({
    title,
    description,
    path: `/meetings/${encodeURIComponent(id)}`,
  });
}

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const meeting = await fetchMeeting(id);
  const minutes = meeting?.status === "closed" ? await fetchMinutes(id) : null;
  const path = `/meetings/${encodeURIComponent(id)}`;

  return (
    <>
      {meeting && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "Event",
            name: meeting.title,
            description: excerpt(
              minutes?.markdown ?? meeting.description ?? meeting.screen_focus_body,
              "班聯會會議資訊與會議紀錄。",
            ),
            startDate: meeting.starts_at,
            endDate: meeting.ends_at,
            eventStatus:
              meeting.status === "closed"
                ? "https://schema.org/EventCompleted"
                : "https://schema.org/EventScheduled",
            location: meeting.location
              ? { "@type": "Place", name: meeting.location }
              : undefined,
            organizer: { "@type": "Organization", name: "新竹高中班聯會" },
            mainEntityOfPage: absoluteUrl(path),
          }}
        />
      )}
      <MeetingDetailPageClient params={params} initialMeeting={meeting} initialMinutes={minutes} />
    </>
=======
  useEffect(() => {
    if (!id || meeting?.status !== "closed") return;
    meetingsApi.minutes(id).then(setMinutes).catch(() => setMinutes(null));
  }, [id, meeting?.status]);

  const screenHref = useMemo(
    () => (meeting ? `/meetings/screen/${meeting.screen_token}` : "#"),
    [meeting],
  );

  const googleCalendarHref = useMemo(() => {
    if (!meeting) return "#";
    const start = meeting.starts_at ? new Date(meeting.starts_at) : new Date();
    const end = meeting.ends_at
      ? new Date(meeting.ends_at)
      : new Date(start.getTime() + 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: meeting.title,
      dates: `${fmt(start)}/${fmt(end)}`,
      details: `主席：${meeting.chair_name || "未填"}`,
      location: meeting.location || "",
    });
    return `https://calendar.google.com/calendar/render?${params}`;
  }, [meeting]);

  if (error) return <main className="p-6 text-sm text-red-500">{error}</main>;
  if (!meeting) return <main className="p-6 text-sm text-[var(--muted)]">載入中...</main>;

  const current = meeting.agenda_items.find((item) => item.id === meeting.current_agenda_item_id);
  const isDraft = meeting.status === "draft";
  const agenda = [...meeting.agenda_items].sort((a, b) => a.order_index - b.order_index);
  const attendanceSummary = minutes?.attendance_summary ?? {};
  const closedVotes = minutes?.votes ?? meeting.votes;

  async function createMinutesDocument() {
    if (!meeting) return;
    setDraftBusy(true);
    setNotice("");
    try {
      const draft = await meetingsApi.createMinutesDocument(meeting.id);
      setNotice(`已建立會議紀錄公文草稿：${draft.title}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立公文草稿失敗");
    } finally {
      setDraftBusy(false);
    }
  }

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
          {(meeting.status === "draft" || meeting.status === "paused") && (
            <button
              disabled={statusBusy}
              onClick={() => runStatus(() => meetingsApi.start(meeting.id))}
              className="inline-flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              <Play size={16} aria-hidden="true" />
              {meeting.status === "paused" ? "繼續會議" : "開始會議"}
            </button>
          )}
          {meeting.status === "active" && (
            <button
              disabled={statusBusy}
              onClick={() => runStatus(() => meetingsApi.pause(meeting.id))}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">
              <Pause size={16} aria-hidden="true" />
              暫停
            </button>
          )}
          {(meeting.status === "active" || meeting.status === "paused") && (
            <button
              disabled={statusBusy}
              onClick={() => {
                if (confirm("確定結束會議？結束後將無法重新開啟。")) {
                  void runStatus(() => meetingsApi.close(meeting.id));
                }
              }}
              className="inline-flex items-center gap-2 rounded-md border border-red-500 px-3 py-2 text-sm font-medium text-red-500 disabled:opacity-50">
              <Square size={16} aria-hidden="true" />
              結束會議
            </button>
          )}
          <Link
            href={`/meetings/${meeting.id}/control`}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            <Radio size={16} aria-hidden="true" />
            遙控控制台
          </Link>
          <a
            href={googleCalendarHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            <CalendarPlus size={16} aria-hidden="true" />
            加入 Google 日曆
          </a>
          <Link
            href={screenHref}
            target="_blank"
            className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-black">
            <Monitor size={16} aria-hidden="true" />
            開啟公開大屏
          </Link>
        </div>
      </div>

      {notice && <p role="alert" className="mb-4 text-sm text-emerald-500">{notice}</p>}

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

      {meeting.status === "closed" && (
        <section className="mb-5 rounded-lg border border-[var(--border)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium text-[var(--muted)]">會後收尾工作台</p>
              <h2 className="mt-1 text-xl font-semibold">紀錄、決議與公文草稿</h2>
            </div>
            <button
              disabled={draftBusy}
              onClick={createMinutesDocument}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-black disabled:opacity-50">
              <ClipboardList size={16} aria-hidden="true" />
              轉公文草稿
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="rounded-md border border-[var(--border)] p-3">
              <p className="text-2xl font-semibold">{attendanceSummary.present_voters ?? 0}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">出席表決權</p>
            </div>
            <div className="rounded-md border border-[var(--border)] p-3">
              <p className="text-2xl font-semibold">{closedVotes.length}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">表決案</p>
            </div>
            <div className="rounded-md border border-[var(--border)] p-3">
              <p className="text-2xl font-semibold">{meeting.decisions.length}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">正式決議</p>
            </div>
            <div className="rounded-md border border-[var(--border)] p-3">
              <p className="text-2xl font-semibold">{minutes?.events.length ?? meeting.events.length}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">事件留痕</p>
            </div>
          </div>
          {closedVotes.length > 0 && (
            <div className="mt-4 grid gap-2">
              {closedVotes.map((vote) => (
                <div key={vote.id} className="rounded-md border border-[var(--border)] p-3 text-sm">
                  <p className="font-medium">{vote.title}</p>
                  <p className="mt-1 text-[var(--muted)]">
                    同意 {vote.tally?.approve ?? 0}、不同意 {vote.tally?.reject ?? 0}、廢票 {vote.tally?.abstain ?? 0}
                    {vote.tally ? `，${vote.tally.passed ? "通過" : "未通過"}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
          {minutes?.markdown && (
            <pre className="mt-4 max-h-72 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-xs whitespace-pre-wrap">
              {minutes.markdown}
            </pre>
          )}
        </section>
      )}

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
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
  );
}
