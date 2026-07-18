"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import Link from "next/link";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Plus,
  Rows3,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { ApiError, calendarApi, orgsApi, usersApi } from "@/lib/api";
import { orgDisplayName } from "@/lib/orgs";
import Drawer from "@/components/ui/Drawer";
import Modal from "@/components/ui/Modal";
import {
  fetchTaiwanCalendarForDates,
  getTaiwanCalendarStatus,
  type TaiwanCalendarDay,
} from "@/lib/taiwanCalendar";
import type {
  CalendarChecklistOut,
  CalendarEventCreate,
  CalendarEventListItem,
  CalendarEventOut,
  CalendarEventType,
  CalendarVisibility,
  OrgRead,
} from "@/lib/types";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const TYPE_LABEL: Record<CalendarEventType, string> = {
  activity: "活動",
  preparation: "準備",
  rehearsal: "彩排",
  interschool_meeting: "他校會議",
  formal_meeting: "正式會議",
  deadline: "截止日",
  other: "其他",
};

const TYPE_COLOR: Record<CalendarEventType, string> = {
  activity: "#0ea5e9",
  preparation: "#f59e0b",
  rehearsal: "#8b5cf6",
  interschool_meeting: "#14b8a6",
  formal_meeting: "#a47b20",
  deadline: "#ef4444",
  other: "#64748b",
};

const VISIBILITY_LABEL: Record<CalendarVisibility, string> = {
  private: "私人",
  participants: "參與者",
  org: "組織",
  logged_in: "登入者",
  public: "公開",
};

type ViewMode = "month" | "week" | "list";

function ymd(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function toInputValue(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateAndTime(date: Date, time: string) {
  const [hh, mm] = time.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hh || 0, mm || 0);
}

function formatTime(value: string | null, allDay = false) {
  if (!value) return "";
  if (allDay) return "全天";
  return new Date(value).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

function rangeFor(cursor: Date, view: ViewMode) {
  if (view === "week") {
    const start = new Date(cursor);
    start.setDate(cursor.getDate() - cursor.getDay());
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 41);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function canEditFormalMeeting() {
  if (typeof window === "undefined") return false;
  if (sessionStorage.getItem("is_superuser") === "true") return true;
  try {
    const permissions = new Set(JSON.parse(sessionStorage.getItem("permissions") || "[]"));
    return permissions.has("admin:all") || permissions.has("meeting:manage");
  } catch {
    return false;
  }
}

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => new Date());
  const [view, setView] = useState<ViewMode>("month");
  const [events, setEvents] = useState<CalendarEventListItem[]>([]);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [holidays, setHolidays] = useState<Map<string, TaiwanCalendarDay>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mine, setMine] = useState(false);
  const [orgId, setOrgId] = useState("");
  const [type, setType] = useState<CalendarEventType | "">("");
  const [visibility, setVisibility] = useState<CalendarVisibility | "">("");
  const [createFor, setCreateFor] = useState<Date | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { start, end } = useMemo(() => rangeFor(cursor, view), [cursor, view]);

  const cells = useMemo(() => {
    const out: Date[] = [];
    const days = view === "week" ? 7 : 42;
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(d);
    }
    return out;
  }, [start, view]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await calendarApi.list({
        start: start.toISOString(),
        end: end.toISOString(),
        mine,
        org_id: orgId || undefined,
        type: type || undefined,
        visibility: visibility || undefined,
      });
      setEvents(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入行事曆失敗");
    } finally {
      setLoading(false);
    }
  }, [end, mine, orgId, start, type, visibility]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    orgsApi
      .list({ active_only: true })
      .then(async (active) => (active.length > 0 ? active : orgsApi.list()))
      .then(setOrgs)
      .catch(() => setOrgs([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchTaiwanCalendarForDates(cells).then((merged) => {
      if (!cancelled) setHolidays(merged);
    });
    return () => {
      cancelled = true;
    };
  }, [cells]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEventListItem[]>();
    for (const event of events) {
      const key = ymd(new Date(event.starts_at));
      const arr = map.get(key);
      if (arr) arr.push(event);
      else map.set(key, [event]);
    }
    return map;
  }, [events]);

  const label = view === "week"
    ? `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`
    : `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`;

  const move = (delta: number) => {
    setCursor((current) => {
      const next = new Date(current);
      if (view === "week") next.setDate(current.getDate() + delta * 7);
      else next.setMonth(current.getMonth() + delta);
      return next;
    });
  };

  const listEvents = [...events].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );

  return (
    <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 sm:py-6">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays size={24} aria-hidden="true" />
          <h1 className="text-2xl font-semibold">行事曆</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCreateFor(new Date())}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-black">
            <Plus size={16} aria-hidden="true" />
            新增行程
          </button>
          <Link
            href="/meetings"
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            <ExternalLink size={16} aria-hidden="true" />
            議事系統
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => move(-1)}
            className="rounded-md border border-[var(--border)] p-2"
            aria-label="上一段">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="min-w-[10rem] text-center text-base font-medium">{label}</span>
          <button
            onClick={() => move(1)}
            className="rounded-md border border-[var(--border)] p-2"
            aria-label="下一段">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <button
            onClick={() => setCursor(new Date())}
            className="ml-1 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
            今天
          </button>
        </div>
        <div className="inline-flex rounded-md border border-[var(--border)] p-0.5 text-sm">
          <ModeButton active={view === "month"} onClick={() => setView("month")} label="月" />
          <ModeButton active={view === "week"} onClick={() => setView("week")} label="週" />
          <ModeButton active={view === "list"} onClick={() => setView("list")} label="列表" />
        </div>
      </div>

      <div className="mb-4 grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
        <select
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm">
          <option value="">全部組織</option>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>{orgDisplayName(org, orgs)}</option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as CalendarEventType | "")}
          className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm">
          <option value="">全部類型</option>
          {Object.entries(TYPE_LABEL).map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as CalendarVisibility | "")}
          className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm">
          <option value="">全部可見度</option>
          {Object.entries(VISIBILITY_LABEL).map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
        <button
          onClick={() => setMine((value) => !value)}
          className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm ${
            mine ? "border-[var(--primary)] bg-[var(--primary)] text-black" : "border-[var(--border)]"
          }`}>
          <Users size={16} aria-hidden="true" />
          我的
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
      {loading && <p className="mb-3 text-sm text-[var(--muted)]">載入中...</p>}

      {view === "list" ? (
        <div className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
          {listEvents.map((event) => (
            <EventRow key={event.id} event={event} onOpen={() => setSelectedId(event.id)} />
          ))}
        </div>
      ) : (
        <>
          <MobileCalendarGrid
            cells={cells}
            cursor={cursor}
            view={view}
            byDay={byDay}
            holidays={holidays}
            onCreate={setCreateFor}
            onOpen={setSelectedId}
          />
          <div className="hidden grid-cols-7 overflow-hidden rounded-md border border-[var(--border)] md:grid">
            {WEEKDAYS.map((day, index) => (
              <div
                key={day}
                className={`border-b border-[var(--border)] py-2 text-center text-xs font-medium ${
                  index === 0 || index === 6 ? "text-red-500/80" : "text-[var(--muted)]"
                }`}>
                {day}
              </div>
            ))}
            {cells.map((day, index) => {
              const key = ymd(day);
              const dayEvents = byDay.get(key) ?? [];
              const { day: holiday, isRestDay, isMakeupWorkday } =
                getTaiwanCalendarStatus(day, holidays);
              const inMonth = view === "week" || day.getMonth() === cursor.getMonth();
              const today = key === ymd(new Date());
              return (
                <div
                  key={key}
                  onClick={() => setCreateFor(new Date(day))}
                  className={`group/cell min-h-[124px] border-b border-r border-[var(--border)] p-1.5 ${
                    index % 7 === 6 ? "border-r-0" : ""
                  } ${inMonth ? "" : "opacity-50"} ${isRestDay ? "bg-red-500/[0.06]" : ""}`}>
                  <div className="mb-1 flex items-start justify-between gap-1">
                    <span className="truncate text-[10px] font-medium leading-5 text-red-500/90">
                      {holiday?.description || (isMakeupWorkday ? "補行上班" : "")}
                    </span>
                    <span
                      className={`text-xs ${
                        today
                          ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)] font-bold text-black"
                          : isRestDay ? "font-semibold text-red-500" : "text-[var(--muted)]"
                      }`}>
                      {day.getDate()}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {dayEvents.slice(0, 5).map((event) => (
                      <button
                        key={event.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(event.id);
                        }}
                        className="rounded border border-[var(--border)] px-1.5 py-1 text-left text-[11px] leading-tight hover:border-[var(--primary)]">
                        <span
                          className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                          style={{ background: TYPE_COLOR[event.event_type] }}
                          aria-hidden="true"
                        />
                        <span className="font-medium">
                          {formatTime(event.starts_at, event.all_day)}
                        </span>{" "}
                        <span className="break-words">{event.title}</span>
                      </button>
                    ))}
                    {dayEvents.length > 5 && (
                      <span className="px-1 text-[10px] text-[var(--muted)]">
                        +{dayEvents.length - 5}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!loading && events.length === 0 && (
        <p className="mt-4 text-center text-sm text-[var(--muted)]">此範圍沒有行程。</p>
      )}

      {createFor && (
        <EventEditor
          date={createFor}
          orgs={orgs}
          onClose={() => setCreateFor(null)}
          onSaved={(id) => {
            setCreateFor(null);
            setSelectedId(id);
            void load();
          }}
        />
      )}
      {selectedId && (
        <EventDrawer
          eventId={selectedId}
          orgs={orgs}
          onClose={() => setSelectedId(null)}
          onChanged={() => void load()}
        />
      )}
    </main>
  );
}

function ModeButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-3 py-1.5 ${active ? "bg-[var(--primary)] text-black" : ""}`}>
      {label}
    </button>
  );
}

function EventRow({ event, onOpen }: { event: CalendarEventListItem; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left">
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ background: TYPE_COLOR[event.event_type] }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{event.title}</p>
        <p className="truncate text-xs text-[var(--muted)]">
          {new Date(event.starts_at).toLocaleString("zh-TW")} · {TYPE_LABEL[event.event_type]}
        </p>
      </div>
      {event.source_meeting_id && <ExternalLink size={16} aria-hidden="true" />}
    </button>
  );
}

function MobileCalendarGrid({
  cells,
  cursor,
  view,
  byDay,
  holidays,
  onCreate,
  onOpen,
}: {
  cells: Date[];
  cursor: Date;
  view: Exclude<ViewMode, "list">;
  byDay: Map<string, CalendarEventListItem[]>;
  holidays: Map<string, TaiwanCalendarDay>;
  onCreate: (date: Date) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-7 overflow-hidden rounded-md border border-[var(--border)] md:hidden">
      {WEEKDAYS.map((day, index) => (
        <div
          key={day}
          className={`border-b border-[var(--border)] py-1.5 text-center text-[11px] font-medium ${
            index === 0 || index === 6 ? "text-red-500/80" : "text-[var(--muted)]"
          }`}>
          {day}
        </div>
      ))}
      {cells.map((day, index) => {
        const key = ymd(day);
        const dayEvents = [...(byDay.get(key) ?? [])].sort(
          (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
        );
        const { day: holiday, isRestDay, isMakeupWorkday } =
          getTaiwanCalendarStatus(day, holidays);
        const inMonth = view === "week" || day.getMonth() === cursor.getMonth();
        const today = key === ymd(new Date());
        return (
          <div
            key={key}
            role="button"
            tabIndex={0}
            onClick={() => onCreate(new Date(day))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onCreate(new Date(day));
              }
            }}
            className={`min-h-[74px] border-b border-r border-[var(--border)] p-1 text-left ${
              index % 7 === 6 ? "border-r-0" : ""
            } ${inMonth ? "" : "opacity-45"} ${isRestDay ? "bg-red-500/[0.06]" : ""}`}>
            <span className="mb-1 flex min-w-0 items-center justify-between gap-1">
              <span className="truncate text-[9px] font-medium leading-4 text-red-500/90">
                {holiday?.description || (isMakeupWorkday ? "補班" : "")}
              </span>
              <span
                className={`shrink-0 text-[11px] leading-5 ${
                  today
                    ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)] font-bold text-black"
                    : isRestDay ? "font-semibold text-red-500" : "text-[var(--muted)]"
                }`}>
                {day.getDate()}
              </span>
            </span>
            <span className="flex flex-col gap-0.5">
              {dayEvents.slice(0, 2).map((event) => (
                <span key={event.id} className="block">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(event.id);
                    }}
                    className="block w-full truncate rounded-sm border border-[var(--border)] px-1 py-0.5 text-[10px] leading-tight hover:border-[var(--primary)]">
                    <span
                      className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
                      style={{ background: TYPE_COLOR[event.event_type] }}
                      aria-hidden="true"
                    />
                    {event.title}
                  </button>
                </span>
              ))}
              {dayEvents.length > 2 && (
                <span className="truncate px-0.5 text-[9px] text-[var(--muted)]">
                  +{dayEvents.length - 2}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EventEditor({
  date,
  orgs,
  onClose,
  onSaved,
}: {
  date: Date;
  orgs: OrgRead[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [eventType, setEventType] = useState<CalendarEventType>("activity");
  const [visibility, setVisibility] = useState<CalendarVisibility>("org");
  const [time, setTime] = useState("09:00");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!title.trim() || !orgId) return;
    setSubmitting(true);
    setError("");
    try {
      const startsAt = fromDateAndTime(date, time);
      const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
      const payload: CalendarEventCreate = {
        title: title.trim(),
        org_id: orgId,
        event_type: eventType,
        visibility,
        location: location.trim() || null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: "confirmed",
        all_day: false,
        participants: [],
        checklist_items: [],
        links: [],
      };
      const event = await calendarApi.create(payload);
      onSaved(event.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立行程失敗");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="新增行程"
      onClose={onClose}
      size="lg"
      mobileFullscreen={false}
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm">
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!title.trim() || !orgId || submitting}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50">
            <Plus size={16} aria-hidden="true" />
            {submitting ? "建立中..." : "建立"}
          </button>
        </>
      )}>
      <div className="grid gap-3">
        <Input label="標題" value={title} onChange={setTitle} autoFocus />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="組織" value={orgId} onChange={setOrgId}>
            <option value="">選擇組織</option>
            {orgs.map((org) => <option key={org.id} value={org.id}>{orgDisplayName(org, orgs)}</option>)}
          </Select>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--muted)]">時間</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="類型"
            value={eventType}
            onChange={(value) => setEventType(value as CalendarEventType)}>
            {Object.entries(TYPE_LABEL).map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </Select>
          <Select
            label="可見度"
            value={visibility}
            onChange={(value) => setVisibility(value as CalendarVisibility)}>
            {Object.entries(VISIBILITY_LABEL).map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </Select>
        </div>
        <Input label="地點" value={location} onChange={setLocation} />
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

function EventDrawer({
  eventId,
  orgs,
  onClose,
  onChanged,
}: {
  eventId: string;
  orgs: OrgRead[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [event, setEvent] = useState<CalendarEventOut | null>(null);
  const [title, setTitle] = useState("");
  const [orgId, setOrgId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<CalendarVisibility>("org");
  const [userSearch, setUserSearch] = useState("");
  const [checkTitle, setCheckTitle] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await calendarApi.get(eventId);
      setEvent(next);
      setTitle(next.title);
      setOrgId(next.org_id ?? "");
      setStartsAt(toInputValue(next.starts_at));
      setEndsAt(toInputValue(next.ends_at));
      setLocation(next.location ?? "");
      setDescription(next.description ?? "");
      setVisibility(next.visibility);
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入事件失敗");
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!event) return;
    setError("");
    try {
      const updated = await calendarApi.update(event.id, {
        title,
        org_id: orgId || undefined,
        starts_at: startsAt ? new Date(startsAt).toISOString() : event.starts_at,
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        location: location || null,
        description: description || null,
        visibility,
      });
      setEvent(updated);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "儲存失敗");
    }
  }

  async function addParticipant() {
    if (!event || !userSearch.trim()) return;
    const users = await usersApi.listForSearch(userSearch.trim());
    const user = users[0];
    if (!user) {
      setError("找不到使用者");
      return;
    }
    await calendarApi.upsertParticipant(event.id, { user_id: user.id });
    setUserSearch("");
    await load();
  }

  async function addChecklistItem() {
    if (!event || !checkTitle.trim()) return;
    await calendarApi.createChecklistItem(event.id, { title: checkTitle.trim() });
    setCheckTitle("");
    await load();
  }

  async function toggleChecklist(item: CalendarChecklistOut) {
    if (!event) return;
    await calendarApi.updateChecklistItem(event.id, item.id, { is_done: !item.is_done });
    await load();
  }

  async function addLink() {
    if (!event || !linkTitle.trim()) return;
    await calendarApi.createLink(event.id, {
      title: linkTitle.trim(),
      url: linkUrl.trim() || null,
      link_type: "external",
    });
    setLinkTitle("");
    setLinkUrl("");
    await load();
  }

  async function removeEvent() {
    if (!event) return;
    await calendarApi.delete(event.id);
    onChanged();
    onClose();
  }

  const projectedLocked = Boolean(event?.source_module && event.source_module !== "meeting");
  const formalLocked = Boolean(event?.source_meeting_id && !canEditFormalMeeting());
  const locked = projectedLocked || formalLocked;

  return (
    <Drawer
      open
      title={event?.title ?? "行程"}
      onClose={onClose}
      width="36rem"
      sheetHeight="88vh">
      <div className="grid gap-4">
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!event ? (
          <p className="text-sm text-[var(--muted)]">載入中...</p>
        ) : (
          <>
            {(event.source_meeting_id || (event.source_module && event.href)) && (
              <div className="flex flex-wrap gap-2 text-xs">
                {event.source_meeting_id && (
                  <Link
                    href={`/meetings/${event.source_meeting_id}`}
                    className="inline-flex items-center gap-1 text-[var(--primary)]">
                    <ExternalLink size={12} aria-hidden="true" />
                    議事系統
                  </Link>
                )}
                {event.source_module && !event.source_meeting_id && event.href && (
                  <Link
                    href={event.href}
                    className="inline-flex items-center gap-1 text-[var(--primary)]">
                    <ExternalLink size={12} aria-hidden="true" />
                    來源模組
                  </Link>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge color={TYPE_COLOR[event.event_type]}>{TYPE_LABEL[event.event_type]}</Badge>
              <Badge>{VISIBILITY_LABEL[event.visibility]}</Badge>
              {projectedLocked && <Badge>系統投影</Badge>}
            </div>
            <fieldset disabled={locked} className="grid gap-3 disabled:opacity-60">
                <Input label="標題" value={title} onChange={setTitle} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-[var(--muted)]">開始</span>
                    <input
                      type="datetime-local"
                      value={startsAt}
                      onChange={(e) => setStartsAt(e.target.value)}
                      className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-[var(--muted)]">結束</span>
                    <input
                      type="datetime-local"
                      value={endsAt}
                      onChange={(e) => setEndsAt(e.target.value)}
                      className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
                    />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select label="組織" value={orgId} onChange={setOrgId}>
                    <option value="">未指定</option>
                    {orgs.map((org) => <option key={org.id} value={org.id}>{orgDisplayName(org, orgs)}</option>)}
                  </Select>
                  <Select
                    label="可見度"
                    value={visibility}
                    onChange={(value) => setVisibility(value as CalendarVisibility)}>
                    {Object.entries(VISIBILITY_LABEL).map(([value, text]) => (
                      <option key={value} value={value}>{text}</option>
                    ))}
                  </Select>
                </div>
                <Input label="地點" value={location} onChange={setLocation} />
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--muted)]">說明</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
                  />
                </label>
              </fieldset>
              <div className="flex justify-end gap-2">
                {!event.source_meeting_id && !event.source_module && (
                  <button
                    onClick={removeEvent}
                    className="inline-flex items-center gap-2 rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-500">
                    <Trash2 size={15} aria-hidden="true" />
                    刪除
                  </button>
                )}
                <button
                  onClick={save}
                  disabled={locked}
                  className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-black disabled:opacity-50">
                  <Check size={15} aria-hidden="true" />
                  儲存
                </button>
              </div>

              <section className="grid gap-2 border-t border-[var(--border)] pt-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Users size={16} aria-hidden="true" />
                  參與者
                </h3>
                {event.participants.map((participant) => (
                  <div key={participant.id} className="flex items-center justify-between text-sm">
                    <span className="truncate">
                      {participant.user?.display_name ?? participant.user_id}
                    </span>
                    <span className="text-xs text-[var(--muted)]">{participant.role}</span>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    disabled={locked}
                    placeholder="姓名或 Email"
                    className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                  />
                  <button
                    onClick={addParticipant}
                    disabled={locked}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                    <Search size={15} aria-hidden="true" />
                    加入
                  </button>
                </div>
              </section>

              <section className="grid gap-2 border-t border-[var(--border)] pt-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Rows3 size={16} aria-hidden="true" />
                  準備清單
                </h3>
                {event.checklist_items.map((item) => (
                  <label key={item.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={item.is_done}
                      disabled={locked}
                      onChange={() => void toggleChecklist(item)}
                    />
                    <span className={item.is_done ? "line-through opacity-60" : ""}>{item.title}</span>
                  </label>
                ))}
                <div className="flex gap-2">
                  <input
                    value={checkTitle}
                    onChange={(e) => setCheckTitle(e.target.value)}
                    disabled={locked}
                    placeholder="新增準備事項"
                    className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                  />
                  <button
                    onClick={addChecklistItem}
                    disabled={locked}
                    className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                    新增
                  </button>
                </div>
              </section>

              <section className="grid gap-2 border-t border-[var(--border)] pt-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <ExternalLink size={16} aria-hidden="true" />
                  連結
                </h3>
                {event.links.map((link) => (
                  <a
                    key={link.id}
                    href={link.url ?? "#"}
                    target={link.url ? "_blank" : undefined}
                    rel="noopener noreferrer"
                    className="truncate text-sm text-[var(--primary)]">
                    {link.title}
                  </a>
                ))}
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <input
                    value={linkTitle}
                    onChange={(e) => setLinkTitle(e.target.value)}
                    disabled={locked}
                    placeholder="連結名稱"
                    className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                  />
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    disabled={locked}
                    placeholder="https://"
                    className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
                  />
                  <button
                    onClick={addLink}
                    disabled={locked}
                    className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                    新增
                  </button>
                </div>
              </section>
          </>
        )}
      </div>
    </Drawer>
  );
}

function Input({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-[var(--border)] bg-transparent px-3 py-2">
        {children}
      </select>
    </label>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="rounded-full border px-2 py-1"
      style={{ borderColor: color ?? "var(--border)", color: color ?? "var(--muted)" }}>
      {children}
    </span>
  );
}
