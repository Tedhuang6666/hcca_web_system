<<<<<<< HEAD
import { redirect } from "next/navigation";

export default function MeetingCalendarRedirect() {
  redirect("/calendar");
=======
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, List, Plus, X } from "lucide-react";
import { meetingsApi, orgsApi } from "@/lib/api";
import {
  fetchTaiwanCalendarForDates,
  getTaiwanCalendarStatus,
  type TaiwanCalendarDay,
} from "@/lib/taiwanCalendar";
import type { MeetingListItem, OrgRead } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  active: "進行中",
  paused: "暫停",
  closed: "已結束",
};
const STATUS_COLOR: Record<string, string> = {
  draft: "#64748b",
  active: "#16a34a",
  paused: "#d97706",
  closed: "#7c3aed",
};
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 會議分組用 key（內部用，月份為 0 起算即可）。 */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
/** 產生 Google 日曆「新增活動」連結（等同把會議匯入 Google 日曆）。 */
function googleCalendarUrl(m: MeetingListItem): string {
  const start = m.starts_at ? new Date(m.starts_at) : new Date();
  const end = m.ends_at ? new Date(m.ends_at) : new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: m.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: `主席：${m.chair_name || "未填"}`,
    location: m.location || "",
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export default function MeetingCalendarPage() {
  const router = useRouter();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [scope, setScope] = useState<"all" | "invited">("all");
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [holidays, setHolidays] = useState<Map<string, TaiwanCalendarDay>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 建立會議用
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [createFor, setCreateFor] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setMeetings(await meetingsApi.list({ invited_only: scope === "invited", limit: 200 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入會議失敗");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  // 權限與組織清單（建立會議用）
  useEffect(() => {
    const isSuperuser = localStorage.getItem("is_superuser") === "true";
    let perms = new Set<string>();
    try {
      perms = new Set(JSON.parse(localStorage.getItem("permissions") || "[]"));
    } catch {
      perms = new Set();
    }
    setCanCreate(isSuperuser || perms.has("admin:all") || perms.has("meeting:create"));
    orgsApi
      .list({ active_only: true })
      .then(async (active) => (active.length > 0 ? active : orgsApi.list()))
      .then(setOrgs)
      .catch(() => setOrgs([]));
  }, []);

  // 月曆格子（補滿前後使整除 7）
  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay()); // 回到當週週日
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(d);
    }
    return out;
  }, [cursor]);

  // 載入畫面涵蓋年度的中華民國行事曆（跨年邊界可能有 2 個年度）
  useEffect(() => {
    let cancelled = false;
    fetchTaiwanCalendarForDates(cells).then((merged) => {
      if (cancelled) return;
      setHolidays(merged);
    });
    return () => {
      cancelled = true;
    };
  }, [cells]);

  // 以「日」為 key 把會議分組
  const byDay = useMemo(() => {
    const map = new Map<string, MeetingListItem[]>();
    for (const m of meetings) {
      if (!m.starts_at) continue;
      const key = ymd(new Date(m.starts_at));
      const arr = map.get(key);
      if (arr) arr.push(m);
      else map.set(key, [m]);
    }
    return map;
  }, [meetings]);

  const todayKey = ymd(new Date());
  const monthLabel = `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`;

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays size={22} aria-hidden="true" />
          <h1 className="text-2xl font-semibold">議事行事曆</h1>
        </div>
        <Link
          href="/meetings"
          className="inline-flex items-center gap-2 self-start rounded-md border border-[var(--border)] px-3 py-2 text-sm">
          <List size={16} aria-hidden="true" />
          會議列表
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
            className="rounded-md border border-[var(--border)] p-2" aria-label="上個月">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="min-w-[8rem] text-center text-base font-medium">{monthLabel}</span>
          <button
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            className="rounded-md border border-[var(--border)] p-2" aria-label="下個月">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <button
            onClick={() => {
              const n = new Date();
              setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
            }}
            className="ml-1 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            今天
          </button>
        </div>
        <div className="inline-flex rounded-md border border-[var(--border)] p-0.5 text-sm">
          <button
            onClick={() => setScope("all")}
            className={`rounded px-3 py-1.5 ${scope === "all" ? "bg-[var(--primary)] text-black" : ""}`}>
            全部會議
          </button>
          <button
            onClick={() => setScope("invited")}
            className={`rounded px-3 py-1.5 ${scope === "invited" ? "bg-[var(--primary)] text-black" : ""}`}>
            我受邀的
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
      {loading && <p className="mb-3 text-sm text-[var(--muted)]">載入中…</p>}
      {canCreate && (
        <p className="mb-3 text-xs text-[var(--muted)]">點選任一天的空白處即可在當天新增會議。</p>
      )}

      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-[var(--border)]">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`border-b border-[var(--border)] py-2 text-center text-xs font-medium ${
              i === 0 || i === 6 ? "text-red-500/80" : "text-[var(--muted)]"
            }`}>
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const key = ymd(d);
          const dayMeetings = byDay.get(key) ?? [];
          const { day: holiday, isRestDay, isMakeupWorkday } = getTaiwanCalendarStatus(d, holidays);
          const isToday = key === todayKey;
          return (
            <div
              key={i}
              onClick={canCreate ? () => setCreateFor(new Date(d)) : undefined}
              className={`group/cell relative min-h-[110px] border-b border-r border-[var(--border)] p-1.5 ${
                i % 7 === 6 ? "border-r-0" : ""
              } ${inMonth ? "" : "opacity-50"} ${
                isRestDay ? "bg-red-500/[0.06]" : ""
              } ${canCreate ? "cursor-pointer transition-colors hover:bg-[var(--primary)]/5" : ""}`}>
              <div className="mb-1 flex items-start justify-between">
                <span className="truncate text-[10px] font-medium leading-5 text-red-500/90">
                  {holiday?.description || (isMakeupWorkday ? "補行上班" : "")}
                </span>
                <span
                  className={`text-xs ${
                    isToday
                      ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)] font-bold text-black"
                      : isRestDay
                        ? "font-semibold text-red-500"
                        : "text-[var(--muted)]"
                  }`}>
                  {d.getDate()}
                </span>
              </div>
              {canCreate && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreateFor(new Date(d));
                  }}
                  aria-label="在這天新增會議"
                  className="absolute right-1 top-1 hidden rounded-full bg-[var(--primary)] p-0.5 text-black group-hover/cell:block">
                  <Plus size={12} aria-hidden="true" />
                </button>
              )}
              <div className="flex flex-col gap-1">
                {dayMeetings.map((m) => (
                  <div
                    key={m.id}
                    onClick={(e) => e.stopPropagation()}
                    className="group rounded-md border border-[var(--border)] bg-[var(--background,transparent)] px-1.5 py-1 text-[11px] leading-tight">
                    <button
                      onClick={() => router.push(`/meetings/${m.id}`)}
                      className="block w-full truncate text-left font-medium hover:underline"
                      title={m.title}>
                      <span
                        className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                        style={{ background: STATUS_COLOR[m.status] }}
                        aria-hidden="true"
                      />
                      {m.starts_at &&
                        new Date(m.starts_at).toLocaleTimeString("zh-TW", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                      {m.title}
                    </button>
                    <div className="mt-0.5 flex items-center justify-between text-[10px] text-[var(--muted)]">
                      <span>{STATUS_LABEL[m.status]}</span>
                      <a
                        href={googleCalendarUrl(m)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="加入 Google 日曆"
                        className="inline-flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:underline">
                        <ExternalLink size={11} aria-hidden="true" />
                        Google
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {!loading && meetings.length === 0 && (
        <p className="mt-4 text-center text-sm text-[var(--muted)]">
          {scope === "invited" ? "目前沒有受邀的會議。" : "此範圍沒有會議。"}
        </p>
      )}

      {createFor && (
        <CreateMeetingDialog
          date={createFor}
          orgs={orgs}
          onClose={() => setCreateFor(null)}
          onCreated={(meetingId) => router.push(`/meetings/${meetingId}/edit`)}
        />
      )}
    </main>
  );
}

function CreateMeetingDialog({
  date,
  orgs,
  onClose,
  onCreated,
}: {
  date: Date;
  orgs: OrgRead[];
  onClose: () => void;
  onCreated: (meetingId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [time, setTime] = useState("09:00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const dateLabel = date.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  async function submit() {
    if (!title.trim() || !orgId) return;
    setSubmitting(true);
    setError("");
    try {
      const [hh, mm] = time.split(":").map(Number);
      const startsAt = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        hh || 0,
        mm || 0,
      );
      const meeting = await meetingsApi.create({
        title: title.trim(),
        org_id: orgId,
        starts_at: startsAt.toISOString(),
        expected_voters: 0,
        quorum_count: 0,
        default_pass_threshold: 0,
      });
      onCreated(meeting.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立會議失敗");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--background)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">新增會議</h2>
          <button onClick={onClose} aria-label="關閉" className="rounded-md p-1 hover:bg-black/5">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="mb-4 text-sm text-[var(--muted)]">{dateLabel}</p>
        <div className="grid gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">會議名稱</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="會議名稱"
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">組織</span>
            <select
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2">
              <option value="">選擇組織</option>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">開會時間</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
            />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm">
            取消
          </button>
          <button
            onClick={submit}
            disabled={!title.trim() || !orgId || submitting}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50">
            <Plus size={16} aria-hidden="true" />
            {submitting ? "建立中…" : "建立並設定議程"}
          </button>
        </div>
      </div>
    </div>
  );
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
}
