"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BookUser,
  CheckSquare,
  FileUp,
  GraduationCap,
  ListChecks,
  Plus,
  Power,
  Search,
  ShieldCheck,
  Square,
  Trash2,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, classApi, usersApi } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import { usePeopleManagementEmbed } from "@/components/admin/PeopleManagementEmbedContext";
import PeopleManagementRedirect from "@/components/admin/PeopleManagementRedirect";
import MobileBackToList from "@/components/ui/MobileBackToList";
import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";
import ClassCorrectionRequestsPanel from "@/components/admin/ClassCorrectionRequestsPanel";
import type {
  ClassMemberOut,
  ClassMembershipOut,
  ClassRoleOut,
  ClassRosterEntryOut,
  ClassStudentRangeOut,
  SchoolClassBulkCreate,
  SchoolClassListItem,
  SchoolClassOut,
  UserSummary,
} from "@/lib/types";

type TabKey = "roles" | "members" | "roster" | "ranges";

const roleHelp: Record<string, string> = {
  class_representative: "同步成為議員，可參與議事、法規與公文流程。",
  class_leader: "檢視本班成員，處理班級日常事務。",
  vice_leader: "協助班長處理班級事務，檢視本班成員。",
};

function classTitle(c: SchoolClassListItem | SchoolClassOut | null) {
  if (!c) return "未選擇班級";
  return c.label || `${c.academic_year} 學年度 ${c.class_code} 班`;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function UserPicker({
  placeholder,
  onPick,
  seatRoster = [],
}: {
  placeholder: string;
  onPick: (user: UserSummary) => void;
  seatRoster?: Array<{ seat_number: number; user: UserSummary }>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);

  useEffect(() => {
    const keyword = query.trim();
    if (keyword.length < 2) {
      setResults([]);
      setLoading(false);
      setSearchError(false);
      return undefined;
    }
    setResults([]);
    setLoading(false);
    setSearchError(false);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setSearchError(false);
      usersApi
        .listForSearch(keyword)
        .then((users) => {
          if (!cancelled) setResults(users);
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
            setSearchError(true);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const keyword = query.trim().toLocaleLowerCase();
  const seatMatches = keyword
    ? seatRoster.filter(({ seat_number, user }) =>
      [String(seat_number), user.display_name, user.student_id ?? "", user.email]
        .some((value) => value.toLocaleLowerCase().includes(keyword)),
    )
    : [];
  const seatByUserId = new Map(seatRoster.map((entry) => [entry.user.id, entry.seat_number]));
  const matchingUsers = new Map<string, UserSummary & { seat_number?: number }>();
  for (const entry of seatMatches) {
    matchingUsers.set(entry.user.id, { ...entry.user, seat_number: entry.seat_number });
  }
  for (const user of results) {
    if (!matchingUsers.has(user.id)) {
      matchingUsers.set(user.id, { ...user, seat_number: seatByUserId.get(user.id) });
    }
  }
  const visibleUsers = Array.from(matchingUsers.values());
  const showResults = Boolean(query.trim());

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-md px-3 py-2"
        style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <Search size={15} style={{ color: "var(--text-muted)" }} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full bg-transparent text-sm outline-none"
          placeholder={placeholder}
          aria-label={placeholder}
          style={{ color: "var(--text-primary)" }}
        />
      </div>
      {showResults && (
        <div
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md"
          style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
          {loading && (
            <div className="px-3 py-3 text-xs" role="status" style={{ color: "var(--text-muted)" }}>
              搜尋中…
            </div>
          )}
          {searchError && (
            <div className="px-3 py-3 text-xs" role="alert" style={{ color: "var(--danger)" }}>
              {seatRoster.length ? "搜尋失敗；仍可從本班座號名冊選取。" : "搜尋失敗，請稍後再試。"}
            </div>
          )}
          {!loading && !searchError && visibleUsers.length === 0 && (
            <div className="px-3 py-3 text-xs" role="status" style={{ color: "var(--text-muted)" }}>
              {keyword.length < 2
                ? seatRoster.length
                  ? "輸入座號，或輸入至少 2 個字搜尋學號、Email 或姓名。"
                  : "請輸入至少 2 個字搜尋學號、Email 或姓名。"
                : "找不到符合的帳號。"}
            </div>
          )}
          {visibleUsers.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => {
                onPick(user);
                setQuery("");
                setResults([]);
              }}
              className="min-h-12 w-full px-3 py-2 text-left transition-colors hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
              aria-label={`選擇 ${user.display_name}${user.seat_number ? `，座號 ${user.seat_number}` : ""}`}
            >
              <span className="block text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {user.display_name}
              </span>
              <span className="block break-all text-xs" style={{ color: "var(--text-muted)" }}>
                {[user.seat_number ? `座號 ${user.seat_number}` : "", user.student_id ? `學號 ${user.student_id}` : "", user.email]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function CreateClassPanel({ onCreated }: { onCreated: () => void }) {
  const defaultYear = String(new Date().getFullYear() - 1911);
  const [mode, setMode] = useState<"single" | "bulk">("bulk");
  const [academicYear, setAcademicYear] = useState(defaultYear);
  const [classCode, setClassCode] = useState("");
  const [grade, setGrade] = useState("1");
  const [classStart, setClassStart] = useState("1");
  const [classEnd, setClassEnd] = useState("20");
  const [seatEnd, setSeatEnd] = useState("40");
  const [busy, setBusy] = useState(false);

  const submitSingle = async () => {
    if (!classCode.trim()) {
      toast.error("請輸入班級代碼");
      return;
    }
    setBusy(true);
    try {
      await classApi.create({
        academic_year: Number(academicYear),
        class_code: classCode.trim(),
        grade: Number(grade),
        label: `${academicYear} 學年度 ${grade} 年 ${classCode.trim()} 班`,
        ranges: [],
      });
      toast.success("班級已建立");
      setClassCode("");
      onCreated();
    } catch (error) {
      toast.error(getErrorMessage(error, "建立班級失敗"));
    } finally {
      setBusy(false);
    }
  };

  const submitBulk = async () => {
    const payload: SchoolClassBulkCreate = {
      academic_year: Number(academicYear),
      is_active: true,
      grades: [
        {
          grade: Number(grade),
          class_start: Number(classStart),
          class_end: Number(classEnd),
          class_code_template: "{grade}{class_no_padded}",
          label_template: "{academic_year} 學年度 {grade} 年 {class_no} 班",
          range_template: {
            student_id_start_template: "{academic_year}{grade}{class_no_padded}{student_no_padded}",
            student_id_end_template: "{academic_year}{grade}{class_no_padded}{student_no_padded}",
            student_no_start: 1,
            student_no_end: Number(seatEnd),
            class_no_width: 2,
            student_no_width: 2,
          },
          class_overrides: [],
        },
      ],
    };
    setBusy(true);
    try {
      const result = await classApi.bulkCreate(payload);
      toast.success(`建立 ${result.succeeded} 班，略過 ${result.skipped} 班`);
      onCreated();
    } catch (error) {
      toast.error(getErrorMessage(error, "批量建立失敗"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-md p-4" style={{ border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            建立班級
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            建立後會同步產生班級 Org 與預設職位。
          </p>
        </div>
        <div className="flex rounded-md p-1" style={{ border: "1px solid var(--border)" }}>
          {(["bulk", "single"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className="rounded px-3 py-1.5 text-xs font-medium"
              style={mode === key
                ? { background: "var(--primary-dim)", color: "var(--primary)" }
                : { color: "var(--text-muted)" }}>
              {key === "bulk" ? "批量" : "單班"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-xs" style={{ color: "var(--text-muted)" }}>
          學年度
          <input className="input mt-1 w-full" value={academicYear}
            onChange={(event) => setAcademicYear(event.target.value)} />
        </label>
        <label className="text-xs" style={{ color: "var(--text-muted)" }}>
          年級
          <input className="input mt-1 w-full" value={grade}
            onChange={(event) => setGrade(event.target.value)} />
        </label>
        {mode === "bulk" ? (
          <>
            <label className="text-xs" style={{ color: "var(--text-muted)" }}>
              起始班號
              <input className="input mt-1 w-full" value={classStart}
                onChange={(event) => setClassStart(event.target.value)} />
            </label>
            <label className="text-xs" style={{ color: "var(--text-muted)" }}>
              結束班號
              <input className="input mt-1 w-full" value={classEnd}
                onChange={(event) => setClassEnd(event.target.value)} />
            </label>
            <label className="text-xs col-span-2" style={{ color: "var(--text-muted)" }}>
              預設座號到
              <input className="input mt-1 w-full" value={seatEnd}
                onChange={(event) => setSeatEnd(event.target.value)} />
            </label>
          </>
        ) : (
          <label className="text-xs col-span-2" style={{ color: "var(--text-muted)" }}>
            班級代碼
            <input className="input mt-1 w-full" value={classCode}
              onChange={(event) => setClassCode(event.target.value)}
              placeholder="例如 115" />
          </label>
        )}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={mode === "bulk" ? submitBulk : submitSingle}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold"
        style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
        <Plus size={16} />
        {busy ? "處理中…" : mode === "bulk" ? "批量建立班級" : "建立班級"}
      </button>
    </section>
  );
}

function ClassList({
  classes,
  selectedId,
  selectedIds,
  onSelect,
  onSelectionChange,
  onBulkAction,
  bulkBusy,
}: {
  classes: SchoolClassListItem[];
  selectedId: string | null;
  selectedIds: string[];
  onSelect: (id: string) => void;
  onSelectionChange: (ids: string[]) => void;
  onBulkAction: (action: "activate" | "deactivate" | "delete") => Promise<void>;
  bulkBusy: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = classes.filter((item) => {
    const haystack = `${item.academic_year} ${item.class_code} ${item.grade} ${item.label ?? ""}`;
    return haystack.includes(query.trim());
  });
  const selectedSet = new Set(selectedIds);
  const filteredIds = filtered.map((item) => item.id);
  const allVisibleSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedSet.has(id));
  const hasSelection = selectedIds.length > 0;

  const toggleSelected = (id: string) => {
    onSelectionChange(
      selectedSet.has(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id],
    );
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      onSelectionChange(selectedIds.filter((id) => !filteredIds.includes(id)));
      return;
    }
    onSelectionChange(Array.from(new Set([...selectedIds, ...filteredIds])));
  };

  return (
    <section className="rounded-md" style={{ border: "1px solid var(--border)" }}>
      <div className="p-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            班級清單
          </h2>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{classes.length} 班</span>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-md px-3 py-2"
          style={{ border: "1px solid var(--border)" }}>
          <Search size={15} style={{ color: "var(--text-muted)" }} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full bg-transparent text-sm outline-none"
            placeholder="搜尋學年度、班級代碼"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleAllVisible}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs"
            style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
            {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
            {allVisibleSelected ? "取消本頁" : "選取本頁"}
          </button>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            已選 {selectedIds.length} 班
          </span>
          {hasSelection && (
            <>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => onBulkAction("deactivate")}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs disabled:opacity-50"
                style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                <Power size={14} /> 批量停用
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => onBulkAction("activate")}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs disabled:opacity-50"
                style={{ border: "1px solid var(--border)", color: "var(--primary)" }}>
                <Power size={14} /> 批量啟用
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => onBulkAction("delete")}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs disabled:opacity-50"
                style={{ border: "1px solid var(--border)", color: "#dc2626" }}>
                <Trash2 size={14} /> 批量刪除
              </button>
            </>
          )}
        </div>
      </div>
      <div className="max-h-[520px] overflow-auto">
        {filtered.map((item) => {
          const active = item.id === selectedId;
          const selected = selectedSet.has(item.id);
          return (
            <div
              key={item.id}
              className="flex items-stretch"
              style={{
                borderBottom: "1px solid var(--border)",
                background: active ? "var(--primary-dim)" : "transparent",
              }}>
              <button
                type="button"
                onClick={() => toggleSelected(item.id)}
                className="flex w-10 flex-shrink-0 items-center justify-center"
                aria-label={selected ? "取消選取班級" : "選取班級"}
                style={{ color: selected ? "var(--primary)" : "var(--text-muted)" }}>
                {selected ? <CheckSquare size={16} /> : <Square size={16} />}
              </button>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className="min-w-0 flex-1 px-2 py-3 text-left transition-colors">
                <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold"
                    style={{ color: active ? "var(--primary)" : "var(--text-primary)" }}>
                    {classTitle(item)}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {item.grade} 年級 · {item.label ?? item.class_code}
                  </p>
                </div>
                <span
                  className="rounded px-2 py-1 text-[11px]"
                  style={{
                    color: item.is_active ? "#047857" : "var(--text-muted)",
                    background: item.is_active ? "rgba(16,185,129,0.12)" : "transparent",
                    border: "1px solid var(--border)",
                  }}>
                  {item.is_active ? "當前" : "停用"}
                </span>
              </div>
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>
            找不到符合條件的班級。
          </div>
        )}
      </div>
    </section>
  );
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        {icon}
        {label}
      </div>
      <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}

function RoleBoard({
  roles,
  candidates,
  onAssign,
}: {
  roles: ClassRoleOut[];
  candidates: Array<{ seat_number?: number; user: UserSummary }>;
  onAssign: (roleKey: string, user: UserSummary) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busyRole, setBusyRole] = useState<string | null>(null);

  const assign = async (roleKey: string, user: UserSummary) => {
    setBusyRole(roleKey);
    try {
      if (await onAssign(roleKey, user)) setSelected((current) => ({ ...current, [roleKey]: "" }));
    } finally {
      setBusyRole(null);
    }
  };

  return (
    <div className="divide-y" style={{ borderColor: "var(--border)" }}>
      {roles.map((role) => {
        const label = role.role_key === "class_representative" ? "班代（議員）" : role.label;
        const available = candidates.filter(({ user }) => !role.holders.some((holder) => holder.user_id === user.id));
        const chosen = available.find(({ user }) => user.id === selected[role.role_key]);
        return (
          <section key={role.role_key} className="py-5 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{label}</h2>
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {role.holders.length ? role.holders.map((holder) => holder.display_name).join("、") : "尚未任命"}
              </span>
            </div>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{roleHelp[role.role_key]}</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <select
                className="input min-h-11 min-w-0 flex-1"
                aria-label={`選擇${label}`}
                value={selected[role.role_key] ?? ""}
                disabled={busyRole !== null || available.length === 0}
                onChange={(event) => setSelected((current) => ({ ...current, [role.role_key]: event.target.value }))}
              >
                <option value="">{available.length ? "從本班成員選擇" : "目前沒有可任命的已連結成員"}</option>
                {available.map(({ seat_number, user }) => (
                  <option key={user.id} value={user.id}>
                    {seat_number ? `${seat_number} 號 · ` : ""}{user.display_name}{user.student_id ? ` · ${user.student_id}` : ""}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-primary min-h-11 disabled:opacity-50"
                disabled={!chosen || busyRole !== null}
                onClick={() => { if (chosen) void assign(role.role_key, chosen.user); }}>
                {busyRole === role.role_key ? "任命中…" : `任命${label}`}
              </button>
            </div>
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer py-2 text-sm" style={{ color: "var(--text-secondary)" }}>找不到人？搜尋其他帳號</summary>
              <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>選取後會加入本班並任命；尚未登入的同學，請先請他使用校內帳號登入。</p>
              {busyRole === null && <UserPicker placeholder={`搜尋帳號並任命${label}`} onPick={(user) => void assign(role.role_key, user)} />}
            </details>
          </section>
        );
      })}
    </div>
  );
}

function MembershipPanel({
  memberships,
  members,
  entries,
  onAdd,
  onEnd,
  onManageRoles,
}: {
  memberships: ClassMembershipOut[];
  members: ClassMemberOut[];
  entries: ClassRosterEntryOut[];
  onAdd: (user: UserSummary) => Promise<void>;
  onEnd: (userId: string) => Promise<void>;
  onManageRoles: () => void;
}) {
  const [query, setQuery] = useState("");
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const memberIds = new Set(entries.map((entry) => entry.user_id).filter(Boolean));
  const studentIds = new Set(entries.map((entry) => entry.student_id));
  const rows = [
    ...entries.map((entry) => ({
      key: entry.id,
      seat: entry.seat_number,
      studentId: entry.student_id,
      name: entry.user?.display_name ?? members.find((member) => member.student_id === entry.student_id)?.display_name ?? "尚未連結帳號",
      userId: entry.user_id,
      source: "座號名冊",
    })),
    ...members.filter((member) => !memberIds.has(member.id) && !studentIds.has(member.student_id ?? "")).map((member) => ({
      key: member.id,
      seat: member.seat_number,
      studentId: member.student_id,
      name: member.display_name,
      userId: member.user_id ?? null,
      source: member.source === "range" ? "學號區間" : member.source === "manual" ? "手動加入" : "人員歸屬",
    })),
  ];
  rows.sort((a, b) => (a.seat ?? Infinity) - (b.seat ?? Infinity));
  const needle = query.trim().toLocaleLowerCase();
  const visible = rows.filter((row) => (!onlyUnlinked || !row.userId)
    && [row.name, row.studentId ?? "", String(row.seat ?? "")].some((value) => value.toLocaleLowerCase().includes(needle)));
  const unlinked = rows.filter((row) => !row.userId).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>班級成員</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>共 {rows.length} 位 · {unlinked} 位待連結帳號</p>
        </div>
        <button type="button" className="btn btn-ghost min-h-11" onClick={onManageRoles}>設定班代（議員）與幹部</button>
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium" style={{ color: "var(--primary)" }}>新增班級成員</summary>
        <p className="mb-2 text-sm" style={{ color: "var(--text-muted)" }}>搜尋已登入的帳號加入本班。尚未登入的同學，可先到「匯入與座號」建立名冊。</p>
        <UserPicker placeholder="搜尋姓名、Email 或學號加入本班" onPick={onAdd} />
      </details>
      {unlinked > 0 && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>待連結的同學使用對應學號的校內帳號登入後，系統會自動配對。</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input className="input min-h-11 min-w-0 flex-1" aria-label="搜尋班級成員" placeholder="搜尋座號、姓名、學號" value={query} onChange={(event) => setQuery(event.target.value)} />
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={onlyUnlinked} onChange={(event) => setOnlyUnlinked(event.target.checked)} />只看待連結
        </label>
      </div>
      <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
        {visible.map((row) => {
          const membership = memberships.find((item) => item.user_id === row.userId && item.status === "active");
          const canEnd = membership && !studentIds.has(row.studentId ?? "") && row.source !== "學號區間" && row.source !== "手動加入";
          return (
            <li key={row.key} className="flex items-center gap-3 py-3">
              <span className="w-10 shrink-0 text-center text-sm tabular-nums" style={{ color: "var(--text-muted)" }}>{row.seat ? `${row.seat} 號` : "—"}</span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium" style={{ color: "var(--text-primary)" }}>{row.name}</p>
                <p className="break-all text-xs" style={{ color: "var(--text-muted)" }}>{row.studentId ?? "未提供學號"} · {row.source}</p>
              </div>
              <span className="shrink-0 text-xs" style={{ color: row.userId ? "var(--success)" : "var(--text-secondary)" }}>{row.userId ? "已連結" : "待連結"}</span>
              {canEnd && <button type="button" className="min-h-11 shrink-0 px-2 text-xs disabled:opacity-50" style={{ color: "var(--danger)" }} disabled={busy !== null}
                aria-label={`將 ${row.name} 移出本班`}
                onClick={async () => {
                  setBusy(row.key);
                  try { await onEnd(membership.user_id); } finally { setBusy(null); }
                }}>移出本班</button>}
            </li>
          );
        })}
      </ul>
      {visible.length === 0 && <p className="py-8 text-center text-sm" role="status" style={{ color: "var(--text-muted)" }}>{rows.length ? "沒有符合的成員，請調整搜尋條件。" : "尚未建立班級名冊，可新增成員或匯入座號名冊。"}</p>}
    </div>
  );
}

function RangePanel({
  ranges,
  onAdd,
  onDelete,
}: {
  ranges: ClassStudentRangeOut[];
  onAdd: (start: string, end: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  return (
    <div className="space-y-4">
      <section className="rounded-md p-4" style={{ border: "1px solid var(--border)" }}>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          新增學號區間
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input className="input" value={start} onChange={(event) => setStart(event.target.value)}
            placeholder="起始學號" />
          <input className="input" value={end} onChange={(event) => setEnd(event.target.value)}
            placeholder="結束學號" />
          <button
            type="button"
            className="rounded-md px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--primary)", color: "var(--primary-fg)" }}
            onClick={async () => {
              await onAdd(start, end);
              setStart("");
              setEnd("");
            }}>
            新增
          </button>
        </div>
      </section>

      <section className="rounded-md overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            已設定區間
          </h3>
        </div>
        {ranges.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            尚未設定學號區間。
          </p>
        ) : (
          ranges.map((range) => (
            <div
              key={range.id}
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <span className="font-mono text-sm" style={{ color: "var(--text-primary)" }}>
                {range.student_id_start} → {range.student_id_end}
              </span>
              <button type="button" className="text-xs" style={{ color: "var(--danger)" }}
                onClick={() => onDelete(range.id)}>
                刪除
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function RosterPanel({
  entries,
  onAdd,
  onBulkImport,
  onUpdate,
  onDelete,
}: {
  entries: ClassRosterEntryOut[];
  onAdd: (seatNumber: number, studentId: string) => Promise<void>;
  onBulkImport: (entries: { seat_number: number; student_id: string }[]) => Promise<void>;
  onUpdate: (id: string, seatNumber: number, studentId: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [seatNumber, setSeatNumber] = useState("");
  const [studentId, setStudentId] = useState("");
  const [pasteValue, setPasteValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSeat, setEditSeat] = useState("");
  const [editStudentId, setEditStudentId] = useState("");

  const parseRows = (value: string) => {
    const rows: { seat_number: number; student_id: string }[] = [];
    for (const [index, line] of value.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      const [seat, id] = line.trim().split(/[,;\t ]+/);
      const number = Number(seat);
      if (!Number.isInteger(number) || number < 1 || !id) {
        throw new Error(`第 ${index + 1} 行格式錯誤，請使用「座號,學號」`);
      }
      rows.push({ seat_number: number, student_id: id.trim() });
    }
    if (rows.length === 0) throw new Error("請先貼上至少一筆名冊資料");
    return rows;
  };

  return (
    <div className="space-y-4">
      <section className="rounded-md p-4" style={{ border: "1px solid var(--border)" }}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            手動維護座號名冊
          </h3>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            每筆資料會保存座號與學號；若學號已有帳號，系統會自動連結，尚未註冊也可以先建立。
          </p>
        </div>
        <div className="mt-3 grid grid-cols-[96px_1fr_auto] gap-2">
          <input
            className="input"
            inputMode="numeric"
            value={seatNumber}
            onChange={(event) => setSeatNumber(event.target.value)}
            placeholder="座號"
            aria-label="座號"
          />
          <input
            className="input font-mono"
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
            placeholder="學號"
            aria-label="學號"
          />
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--primary)", color: "var(--primary-fg)" }}
            onClick={async () => {
              const number = Number(seatNumber);
              if (!Number.isInteger(number) || number < 1 || !studentId.trim()) {
                toast.error("請輸入有效座號與學號");
                return;
              }
              await onAdd(number, studentId.trim());
              setSeatNumber("");
              setStudentId("");
            }}
          >
            <Plus size={15} /> 新增
          </button>
        </div>
        <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            貼上多筆名冊
            <textarea
              className="input mt-1 min-h-24 w-full font-mono text-xs"
              value={pasteValue}
              onChange={(event) => setPasteValue(event.target.value)}
              placeholder={"1,1150101\n2,1150102\n3,1150103"}
              aria-label="批量貼上座號與學號"
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              支援逗號、Tab 或空白分隔；相同座號會更新原資料。
            </span>
            <button
              type="button"
              className="rounded-md px-3 py-2 text-xs font-semibold"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              onClick={async () => {
                try {
                  await onBulkImport(parseRows(pasteValue));
                  setPasteValue("");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "批量匯入失敗");
                }
              }}
            >
              匯入名冊
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-md" style={{ border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              班級座號名冊
            </h3>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              共 {entries.length} 筆 · 可直接編輯或刪除
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                <th className="px-4 py-2 text-left font-medium">座號</th>
                <th className="px-4 py-2 text-left font-medium">學號</th>
                <th className="px-4 py-2 text-left font-medium">帳號連結</th>
                <th className="px-4 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const editing = editingId === entry.id;
                return (
                  <tr key={entry.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="px-4 py-2" style={{ color: "var(--text-primary)" }}>
                      {editing ? (
                        <input className="input w-20" inputMode="numeric" value={editSeat}
                          onChange={(event) => setEditSeat(event.target.value)} aria-label="編輯座號" />
                      ) : entry.seat_number}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs" style={{ color: "var(--text-primary)" }}>
                      {editing ? (
                        <input className="input min-w-36" value={editStudentId}
                          onChange={(event) => setEditStudentId(event.target.value)} aria-label="編輯學號" />
                      ) : entry.student_id}
                    </td>
                    <td className="px-4 py-2 text-xs" style={{ color: entry.user ? "var(--text-secondary)" : "var(--text-muted)" }}>
                      {entry.user ? `${entry.user.display_name} · 已連結` : "尚未註冊帳號"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {editing ? (
                        <>
                          <button type="button" className="mr-3 text-xs font-medium" style={{ color: "var(--primary)" }}
                            onClick={async () => {
                              const number = Number(editSeat);
                              if (!Number.isInteger(number) || number < 1 || !editStudentId.trim()) {
                                toast.error("請輸入有效座號與學號");
                                return;
                              }
                              await onUpdate(entry.id, number, editStudentId.trim());
                              setEditingId(null);
                            }}>儲存</button>
                          <button type="button" className="text-xs" style={{ color: "var(--text-muted)" }}
                            onClick={() => setEditingId(null)}>取消</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="mr-3 text-xs" style={{ color: "var(--primary)" }}
                            onClick={() => {
                              setEditingId(entry.id);
                              setEditSeat(String(entry.seat_number));
                              setEditStudentId(entry.student_id);
                            }}>編輯</button>
                          <button type="button" className="text-xs" style={{ color: "var(--danger)" }}
                            onClick={() => onDelete(entry.id)}>刪除</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {entries.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                  尚未建立座號名冊，先輸入一筆或貼上多筆資料。
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ClassWorkspace({
  classId,
  onClassChanged,
}: {
  classId: string;
  onClassChanged: () => void;
}) {
  const [detail, setDetail] = useState<SchoolClassOut | null>(null);
  const [members, setMembers] = useState<ClassMemberOut[]>([]);
  const [memberships, setMemberships] = useState<ClassMembershipOut[]>([]);
  const [rosterEntries, setRosterEntries] = useState<ClassRosterEntryOut[]>([]);
  const [roles, setRoles] = useState<ClassRoleOut[]>([]);
  const [tab, setTab] = useState<TabKey>("members");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    Promise.all([
      classApi.get(classId),
      classApi.members(classId),
      classApi.memberships(classId),
      classApi.roster(classId),
      classApi.roles(classId),
    ])
      .then(([nextDetail, nextMembers, nextMemberships, nextRosterEntries, nextRoles]) => {
        setDetail(nextDetail);
        setMembers(nextMembers);
        setMemberships(nextMemberships);
        setRosterEntries(nextRosterEntries);
        setRoles(nextRoles);
      })
      .catch((error) => {
        setLoadError(true);
        toast.error(getErrorMessage(error, "載入班級資料失敗"));
      })
      .finally(() => setLoading(false));
  }, [classId]);

  useEffect(load, [load]);

  const roleHolderCount = useMemo(
    () => roles.reduce((sum, role) => sum + role.holders.length, 0),
    [roles],
  );
  const candidates = useMemo(() => {
    const users = new Map<string, { seat_number?: number; user: UserSummary }>();
    for (const membership of memberships) {
      if (membership.status === "active" && membership.user) users.set(membership.user_id, { user: membership.user });
    }
    for (const member of members) {
      if (member.user_id) users.set(member.user_id, { seat_number: member.seat_number ?? undefined, user: { ...member, id: member.user_id } });
    }
    for (const entry of rosterEntries) {
      if (entry.user) users.set(entry.user.id, { seat_number: entry.seat_number, user: entry.user });
    }
    return [...users.values()].sort((a, b) => (a.seat_number ?? Infinity) - (b.seat_number ?? Infinity));
  }, [memberships, members, rosterEntries]);
  const unlinkedCount = rosterEntries.filter((entry) => !entry.user_id).length
    + members.filter((member) => !member.user_id
      && !rosterEntries.some((entry) => entry.student_id === member.student_id)).length;

  if (loadError) {
    return <section className="space-y-3 rounded-md p-6" role="alert" style={{ border: "1px solid var(--border)" }}>
      <p style={{ color: "var(--text-primary)" }}>無法載入班級資料，請重新載入。</p>
      <button type="button" className="btn btn-primary min-h-11" onClick={load}>重新載入班級</button>
    </section>;
  }

  if (loading || !detail) {
    return (
      <section className="rounded-md p-8 text-center text-sm" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
        載入班級工作台…
      </section>
    );
  }

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "members", label: "班級成員" },
    { key: "roles", label: "班代與幹部", count: roleHolderCount },
    { key: "roster", label: "匯入與座號" },
    { key: "ranges", label: "自動歸班規則", count: detail.ranges.length },
  ];

  const assignRole = async (roleKey: string, user: UserSummary) => {
    try {
      await classApi.assignRole(classId, roleKey, { user_id: user.id });
      toast.success(`已任命 ${user.display_name}`);
      load();
      return true;
    } catch (error) {
      toast.error(getErrorMessage(error, "任命失敗"));
      return false;
    }
  };

  const addMembership = async (user: UserSummary) => {
    try {
      await classApi.addMembership(classId, { user_id: user.id, source: "manual" });
      toast.success(`${user.display_name} 已加入名冊`);
      load();
    } catch (error) {
      toast.error(getErrorMessage(error, "加入名冊失敗"));
    }
  };

  const endMembership = async (userId: string) => {
    try {
      await classApi.endMembership(classId, userId);
      toast.success("已將成員移出本班");
      load();
    } catch (error) {
      toast.error(getErrorMessage(error, "更新名冊失敗"));
    }
  };

  const addRange = async (start: string, end: string) => {
    if (!start.trim() || !end.trim()) {
      toast.error("請輸入完整學號區間");
      return;
    }
    try {
      await classApi.addRange(classId, {
        student_id_start: start.trim(),
        student_id_end: end.trim(),
      });
      toast.success("學號區間已新增");
      load();
      onClassChanged();
    } catch (error) {
      toast.error(getErrorMessage(error, "新增區間失敗"));
    }
  };

  const addRosterEntry = async (seatNumber: number, studentId: string) => {
    try {
      await classApi.addRoster(classId, { seat_number: seatNumber, student_id: studentId });
      toast.success(`座號 ${seatNumber} 已加入名冊`);
      load();
    } catch (error) {
      toast.error(getErrorMessage(error, "新增名冊資料失敗"));
      throw error;
    }
  };

  const bulkImportRoster = async (entries: { seat_number: number; student_id: string }[]) => {
    try {
      const result = await classApi.bulkRoster(classId, { entries });
      toast.success(`名冊匯入完成：新增 ${result.created} 筆、更新 ${result.updated} 筆`);
      load();
    } catch (error) {
      toast.error(getErrorMessage(error, "批量匯入名冊失敗"));
      throw error;
    }
  };

  const updateRosterEntry = async (id: string, seatNumber: number, studentId: string) => {
    try {
      await classApi.updateRoster(classId, id, { seat_number: seatNumber, student_id: studentId });
      toast.success("名冊資料已更新");
      load();
    } catch (error) {
      toast.error(getErrorMessage(error, "更新名冊資料失敗"));
      throw error;
    }
  };

  const deleteRosterEntry = async (id: string) => {
    if (!confirm("確定要刪除此筆座號名冊資料？")) return;
    try {
      await classApi.deleteRoster(classId, id);
      toast.success("名冊資料已刪除");
      load();
    } catch (error) {
      toast.error(getErrorMessage(error, "刪除名冊資料失敗"));
    }
  };

  const deleteRange = async (id: string) => {
    try {
      await classApi.deleteRange(classId, id);
      toast.success("學號區間已刪除");
      load();
      onClassChanged();
    } catch (error) {
      toast.error(getErrorMessage(error, "刪除區間失敗"));
    }
  };

  const toggleActive = async () => {
    try {
      await classApi.update(classId, { is_active: !detail.is_active });
      toast.success("班級狀態已更新");
      load();
      onClassChanged();
    } catch (error) {
      toast.error(getErrorMessage(error, "更新班級狀態失敗"));
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-md p-5" style={{ border: "1px solid var(--border)" }}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <GraduationCap size={22} style={{ color: "var(--primary)" }} />
              <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                {classTitle(detail)}
              </h1>
            </div>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {detail.grade} 年級 · {detail.is_active ? "目前使用中" : "已停用，保留歷史資料"}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleActive}
            className="inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium"
            style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
            {detail.is_active ? "停用當前班級" : "設為當前班級"}
          </button>
        </div>

        {tab === "members" && <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile icon={<UsersRound size={15} />} label="已連結帳號" value={candidates.length} />
          <StatTile icon={<BookUser size={15} />} label="待連結帳號" value={unlinkedCount} />
          <StatTile icon={<ListChecks size={15} />} label="座號名冊" value={rosterEntries.length} />
          <StatTile icon={<ShieldCheck size={15} />} label="已任命職位" value={roleHolderCount} />

        </div>}
      </section>

      <nav className="module-tabs-scroll max-w-full overflow-x-auto" aria-label="班級管理分頁">
        <div className="module-tabs-list">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            aria-pressed={tab === item.key}
            className={`module-tab-link min-h-11 cursor-pointer${tab === item.key ? " is-active" : ""}`}>
            <span>{item.label}</span>
            {item.count !== undefined && <span className="ml-1 text-xs">{item.count}</span>}
          </button>
        ))}
        </div>
      </nav>

      {tab === "roles" && (
        <div key="roles" className="tab-panel-transition">
          <RoleBoard roles={roles} candidates={candidates} onAssign={assignRole} />
        </div>
      )}
      {tab === "members" && (
        <div key="members" className="tab-panel-transition">
          <MembershipPanel
            memberships={memberships}
            members={members}
            entries={rosterEntries}
            onManageRoles={() => setTab("roles")}
            onAdd={addMembership}
            onEnd={endMembership}
          />
        </div>
      )}
      {tab === "roster" && (
        <div key="roster" className="tab-panel-transition">
          <RosterPanel
            entries={rosterEntries}
            onAdd={addRosterEntry}
            onBulkImport={bulkImportRoster}
            onUpdate={updateRosterEntry}
            onDelete={deleteRosterEntry}
          />
        </div>
      )}
      {tab === "ranges" && (
        <div key="ranges" className="tab-panel-transition">
          <RangePanel ranges={detail.ranges} onAdd={addRange} onDelete={deleteRange} />
        </div>
      )}
    </div>
  );
}

function RosterFileImportPanel({ onImported }: { onImported: () => void }) {
  const [academicYear, setAcademicYear] = useState(String(new Date().getFullYear() - 1911));
  const [busy, setBusy] = useState(false);

  return (
    <section className="rounded-md p-4" style={{ border: "1px solid var(--border)" }}>
      <div className="flex items-start gap-3">
        <FileUp size={18} style={{ color: "var(--primary)", marginTop: 2 }} />
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            匯入編班名單檔案
          </h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            支援 PDF 或 UTF-8 CSV；會自動建立缺少的班級、人員主檔與座號名冊。
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-[96px_1fr]">
        <input
          className="input"
          inputMode="numeric"
          value={academicYear}
          onChange={(event) => setAcademicYear(event.target.value)}
          placeholder="學年度"
          aria-label="匯入學年度"
        />
        <AnimatedFileUpload
          accept=".pdf,.csv,application/pdf,text/csv"
          label={busy ? "名冊匯入中…" : "拖曳 PDF / CSV 名冊到這裡"}
          hint="選取後立即匯入，支援 UTF-8 CSV"
          disabled={busy}
          onUpload={async (file, reportProgress) => {
            setBusy(true);
            try {
              return await classApi.importRosterFile(
                file,
                Number(academicYear) || undefined,
                reportProgress,
              );
            } finally {
              setBusy(false);
            }
          }}
          onUploaded={(result) => {
            toast.success(
              `匯入 ${result.total} 筆，建立 ${result.classes_created} 個班級，新增 ${result.roster_created} 筆座號名冊`,
            );
            onImported();
          }}
        />
      </div>
    </section>
  );
}

export default function ClassesAdminPage() {
  const embedded = usePeopleManagementEmbed();
  return embedded ? <ClassManagementPanel /> : <PeopleManagementRedirect section="classes" />;
}

function ClassManagementPanel() {
  const { can } = usePermissions();
  const allowed = can("class:manage");
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 手機版 master-detail：選班級後切到工作台、未選顯示清單（桌機 xl 以上恆並排）。
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showCorrectionRequests, setShowCorrectionRequests] = useState(false);
  const [workspaceVersion, setWorkspaceVersion] = useState(0);

  const loadClasses = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    classApi
      .list()
      .then((items) => {
        setClasses(items);
        setSelectedClassIds((current) => current.filter((id) => items.some((item) => item.id === id)));
        setSelectedId((current) =>
          current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null,
        );
      })
      .catch((error) => {
        setLoadError(true);
        toast.error(getErrorMessage(error, "載入班級清單失敗"));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (allowed) loadClasses();
    else setLoading(false);
  }, [allowed, loadClasses]);

  const runBulkAction = async (action: "activate" | "deactivate" | "delete") => {
    if (selectedClassIds.length === 0) return;
    const verb = action === "activate" ? "啟用" : action === "deactivate" ? "停用" : "刪除";
    if (!confirm(`確定要${verb} ${selectedClassIds.length} 個班級？`)) return;
    setBulkBusy(true);
    try {
      const result = await classApi.bulkAction(selectedClassIds, action);
      toast.success(`批量${verb}完成：${result.succeeded}/${result.total} 成功`);
      if (result.failed > 0) {
        const failed = result.results.filter((item) => !item.ok).slice(0, 3);
        toast.error(failed.map((item) => item.detail ?? item.class_id).join("；"));
      }
      setSelectedClassIds([]);
      loadClasses();
    } catch (error) {
      toast.error(getErrorMessage(error, `批量${verb}失敗`));
    } finally {
      setBulkBusy(false);
    }
  };

  if (!allowed) {
    return (
      <div className="py-24 text-center" style={{ color: "var(--text-muted)" }}>
        目前帳號無法管理班級，請聯繫管理員確認是否已授權。
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-5">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
              班級、名冊與議員設定
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              選擇班級後，可核對同學與座號、設定班代（議員）或處理班級更正。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/shop" className="btn btn-ghost min-h-11">返回商品目錄</Link>
            <span className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
              style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
              <UsersRound size={16} />
              {loading ? "載入中" : loadError ? "班級清單未載入" : `${classes.length} 個班級`}
            </span>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCorrectionRequests((current) => !current)}
            aria-pressed={showCorrectionRequests}
            className={showCorrectionRequests ? "btn btn-primary min-h-11" : "btn btn-ghost min-h-11"}
          >
            {showCorrectionRequests ? "返回班級名冊" : "班級更正申請"}
          </button>
        </div>

        {loadError ? (
          <section role="alert" className="space-y-3 rounded-md p-5" style={{ border: "1px solid var(--danger)", color: "var(--text-primary)" }}>
            <p>無法載入班級清單，請重新載入後再操作。</p>
            <button type="button" className="btn btn-primary min-h-11" onClick={loadClasses}>重新載入班級清單</button>
          </section>
        ) : showCorrectionRequests ? (
          <ClassCorrectionRequestsPanel />
        ) : (
        <>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
          <aside className={`space-y-4 ${mobileDetailOpen ? "hidden xl:block" : ""}`}>
            <ClassList
              classes={classes}
              selectedId={selectedId}
              selectedIds={selectedClassIds}
              onSelect={(id) => { setSelectedId(id); setMobileDetailOpen(true); }}
              onSelectionChange={setSelectedClassIds}
              onBulkAction={runBulkAction}
              bulkBusy={bulkBusy}
            />
            <details className="rounded-md p-4" style={{ border: "1px solid var(--border)" }}>
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">匯入名單或建立班級</summary>
              <div className="mt-3 space-y-4">
                <RosterFileImportPanel onImported={() => { loadClasses(); setWorkspaceVersion((value) => value + 1); }} />
                <CreateClassPanel onCreated={loadClasses} />
              </div>
            </details>
          </aside>
          <main className={mobileDetailOpen ? "" : "hidden xl:block"}>
            <div className="xl:hidden mb-3">
              <MobileBackToList onBack={() => setMobileDetailOpen(false)} label="返回班級清單" />
            </div>
            {selectedId ? (
              <ClassWorkspace
                key={`${selectedId}:${workspaceVersion}`}
                classId={selectedId}
                onClassChanged={loadClasses}
              />
            ) : (
              <section className="rounded-md p-10 text-center text-sm"
                style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                請先建立或選擇班級。
              </section>
            )}
          </main>
        </div>
        </>
        )}
    </div>
  );
}
