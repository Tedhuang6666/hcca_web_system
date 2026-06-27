"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  BookUser,
  CalendarDays,
  CheckSquare,
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
import MobileBackToList from "@/components/ui/MobileBackToList";
import type {
  ClassMemberOut,
  ClassMembershipOut,
  ClassRoleOut,
  ClassStudentRangeOut,
  SchoolClassBulkCreate,
  SchoolClassListItem,
  SchoolClassOut,
  UserSummary,
} from "@/lib/types";

type TabKey = "overview" | "roles" | "members" | "ranges";

const roleAccent: Record<string, string> = {
  class_representative: "#2563eb",
  class_leader: "#0f766e",
  vice_leader: "#7c3aed",
  lunch_manager: "#d97706",
  treasurer: "#be123c",
  discipline: "#475569",
  general_affairs: "#64748b",
};

const roleHelp: Record<string, string> = {
  class_representative: "同步成為議員，可參與議事、法規與公文流程。",
  class_leader: "管理班級日常與本班訂購收款。",
  vice_leader: "協助班長處理班級與訂購事項。",
  lunch_manager: "處理本班學餐收款、班級領取碼與領餐。",
  treasurer: "處理商品與學餐的本班收款彙整。",
  discipline: "保留風紀身分與後續風紀模組權限。",
  general_affairs: "處理班級一般事務。",
};

function roleColor(roleKey: string) {
  return roleAccent[roleKey] ?? "var(--primary)";
}

function classTitle(c: SchoolClassListItem | SchoolClassOut | null) {
  if (!c) return "未選擇班級";
  return `${c.academic_year} 學年度 ${c.class_code} 班`;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function UserPicker({
  placeholder,
  onPick,
}: {
  placeholder: string;
  onPick: (user: UserSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      usersApi
        .listForSearch(query.trim())
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query]);

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
          style={{ color: "var(--text-primary)" }}
        />
      </div>
      {(results.length > 0 || loading) && (
        <div
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-md"
          style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
          {loading && (
            <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
              搜尋中…
            </div>
          )}
          {results.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => {
                onPick(user);
                setQuery("");
                setResults([]);
              }}
              className="w-full px-3 py-2 text-left transition-colors hover:bg-black/5"
            >
              <span className="block text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {user.display_name}
              </span>
              <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                {user.student_id ?? user.email}
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
    <div className="rounded-md p-3" style={{ border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}

function RoleBoard({
  roles,
  onAssign,
}: {
  roles: ClassRoleOut[];
  onAssign: (roleKey: string, user: UserSummary) => Promise<void>;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {roles.map((role) => {
        const color = roleColor(role.role_key);
        return (
          <section
            key={role.role_key}
            className="rounded-md p-4"
            style={{ border: `1px solid ${color}33`, background: "var(--card-bg)" }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                  <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {role.label}
                  </h3>
                </div>
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  {roleHelp[role.role_key] ?? "班級職位。"}
                </p>
              </div>
              <span className="rounded px-2 py-1 text-[11px] font-medium"
                style={{ color, background: `${color}17` }}>
                {role.holders.length || "未任命"}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {role.holders.length === 0 ? (
                <p className="rounded-md px-3 py-2 text-xs"
                  style={{ border: "1px dashed var(--border)", color: "var(--text-muted)" }}>
                  尚未任命
                </p>
              ) : (
                role.holders.map((holder) => (
                  <div
                    key={holder.user_position_id}
                    className="flex items-center justify-between rounded-md px-3 py-2"
                    style={{ border: "1px solid var(--border)" }}>
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {holder.display_name}
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {holder.student_id ?? holder.email} · {holder.start_date} 起
                      </p>
                    </div>
                    <BadgeCheck size={17} style={{ color }} />
                  </div>
                ))
              )}
            </div>

            <div className="mt-3">
              <UserPicker
                placeholder={`任命${role.label}`}
                onPick={(user) => onAssign(role.role_key, user)}
              />
            </div>

            {role.permission_codes.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {role.permission_codes.slice(0, 6).map((code) => (
                  <span
                    key={code}
                    className="rounded px-1.5 py-0.5 text-[11px] font-mono"
                    style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    {code}
                  </span>
                ))}
                {role.permission_codes.length > 6 && (
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    +{role.permission_codes.length - 6}
                  </span>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MembershipPanel({
  memberships,
  members,
  onAdd,
  onEnd,
}: {
  memberships: ClassMembershipOut[];
  members: ClassMemberOut[];
  onAdd: (user: UserSummary) => Promise<void>;
  onEnd: (userId: string) => Promise<void>;
}) {
  const activeMemberships = memberships.filter((item) => item.status === "active");
  const rangeMembers = members.filter((item) => item.source === "range");

  return (
    <div className="space-y-4">
      <section className="rounded-md p-4" style={{ border: "1px solid var(--border)" }}>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          加入名冊
        </h3>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          名冊是學年度快照；轉班或特殊學生請用這裡加入，不會影響歷史訂單。
        </p>
        <div className="mt-3">
          <UserPicker placeholder="搜尋學生姓名、Email 或學號" onPick={onAdd} />
        </div>
      </section>

      <section className="rounded-md overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            年度名冊快照
          </h3>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {activeMemberships.length} 位有效名冊成員 · {rangeMembers.length} 位由學號區間推導
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                <th className="px-4 py-2 text-left font-medium">姓名</th>
                <th className="px-4 py-2 text-left font-medium">學號</th>
                <th className="px-4 py-2 text-left font-medium">來源</th>
                <th className="px-4 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {activeMemberships.map((membership) => (
                <tr key={membership.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-4 py-2" style={{ color: "var(--text-primary)" }}>
                    {membership.user?.display_name ?? membership.user_id}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                    {membership.user?.student_id ?? "—"}
                  </td>
                  <td className="px-4 py-2" style={{ color: "var(--text-muted)" }}>
                    {membership.source}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onEnd(membership.user_id)}
                      className="text-xs"
                      style={{ color: "var(--danger)" }}>
                      結束歸屬
                    </button>
                  </td>
                </tr>
              ))}
              {activeMemberships.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm"
                    style={{ color: "var(--text-muted)" }}>
                    尚無手動名冊快照。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
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
  const [roles, setRoles] = useState<ClassRoleOut[]>([]);
  const [tab, setTab] = useState<TabKey>("overview");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      classApi.get(classId),
      classApi.members(classId),
      classApi.memberships(classId),
      classApi.roles(classId),
    ])
      .then(([nextDetail, nextMembers, nextMemberships, nextRoles]) => {
        setDetail(nextDetail);
        setMembers(nextMembers);
        setMemberships(nextMemberships);
        setRoles(nextRoles);
      })
      .catch((error) => toast.error(getErrorMessage(error, "載入班級資料失敗")))
      .finally(() => setLoading(false));
  }, [classId]);

  useEffect(load, [load]);

  const roleHolderCount = useMemo(
    () => roles.reduce((sum, role) => sum + role.holders.length, 0),
    [roles],
  );

  if (loading || !detail) {
    return (
      <section className="rounded-md p-8 text-center text-sm" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
        載入班級工作台…
      </section>
    );
  }

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "overview", label: "總覽" },
    { key: "roles", label: "職位", count: roleHolderCount },
    { key: "members", label: "名冊", count: memberships.filter((item) => item.status === "active").length },
    { key: "ranges", label: "學號區間", count: detail.ranges.length },
  ];

  const assignRole = async (roleKey: string, user: UserSummary) => {
    try {
      await classApi.assignRole(classId, roleKey, { user_id: user.id });
      toast.success(`已任命 ${user.display_name}`);
      load();
    } catch (error) {
      toast.error(getErrorMessage(error, "任命失敗"));
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
      toast.success("已結束班級歸屬");
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
              {detail.grade} 年級 · RBAC Org {detail.org_id ? "已綁定" : "尚未綁定"}
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

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile icon={<UsersRound size={15} />} label="推導成員" value={members.length} />
          <StatTile icon={<BookUser size={15} />} label="名冊快照" value={memberships.filter((item) => item.status === "active").length} />
          <StatTile icon={<ShieldCheck size={15} />} label="已任命職位" value={roleHolderCount} />
          <StatTile icon={<ListChecks size={15} />} label="學號區間" value={detail.ranges.length} />
        </div>
      </section>

      <nav className="module-tabs-scroll max-w-full overflow-x-auto" aria-label="班級管理分頁">
        <div className="module-tabs-list">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`module-tab-link cursor-pointer${tab === item.key ? " is-active" : ""}`}>
            <span>{item.label}</span>
            {item.count !== undefined && <span className="ml-1 text-xs">{item.count}</span>}
          </button>
        ))}
        </div>
      </nav>

      {tab === "overview" && (
        <div key="overview" className="tab-panel-transition grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-md p-4" style={{ border: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              身分組狀態
            </h2>
            <div className="mt-3 space-y-2">
              {roles.map((role) => (
                <div key={role.role_key} className="flex items-center justify-between rounded-md px-3 py-2"
                  style={{ border: "1px solid var(--border)" }}>
                  <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                    {role.label}
                  </span>
                  <span className="text-xs" style={{ color: role.holders.length ? roleColor(role.role_key) : "var(--text-muted)" }}>
                    {role.holders.length ? role.holders.map((h) => h.display_name).join("、") : "未任命"}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-md p-4" style={{ border: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              重要連動
            </h2>
            <div className="mt-3 space-y-3 text-sm" style={{ color: "var(--text-secondary)" }}>
              <p className="flex gap-2"><BadgeCheck size={16} style={{ color: "#2563eb" }} />班代會同步取得議員職位與議事/法規/公文權限。</p>
              <p className="flex gap-2"><CalendarDays size={16} style={{ color: "#d97706" }} />午餐股長可取得本班學餐整班領取碼。</p>
              <p className="flex gap-2"><ShieldCheck size={16} style={{ color: "#0f766e" }} />班長、副班長與總務可處理本班訂購收款。</p>
            </div>
          </section>
        </div>
      )}
      {tab === "roles" && (
        <div key="roles" className="tab-panel-transition">
          <RoleBoard roles={roles} onAssign={assignRole} />
        </div>
      )}
      {tab === "members" && (
        <div key="members" className="tab-panel-transition">
          <MembershipPanel
            memberships={memberships}
            members={members}
            onAdd={addMembership}
            onEnd={endMembership}
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

export default function ClassesAdminPage() {
  const { can } = usePermissions();
  const allowed = can("class:manage");
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 手機版 master-detail：選班級後切到工作台、未選顯示清單（桌機 xl 以上恆並排）。
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadClasses = useCallback(() => {
    setLoading(true);
    classApi
      .list()
      .then((items) => {
        setClasses(items);
        setSelectedClassIds((current) => current.filter((id) => items.some((item) => item.id === id)));
        setSelectedId((current) =>
          current && items.some((item) => item.id === current) ? current : items[0]?.id ?? null,
        );
      })
      .catch((error) => toast.error(getErrorMessage(error, "載入班級清單失敗")))
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
        需要 class:manage 權限才能管理班級。
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase" style={{ color: "var(--primary)" }}>
            Class Operations
          </p>
          <h1 className="mt-1 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            班級系統工作台
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            管理班級 Org、年度名冊、正式職位身分組與學號區間。
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
          style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
          <UsersRound size={16} />
          {loading ? "載入中" : `${classes.length} 個班級`}
        </span>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
        <aside className={`space-y-4 ${mobileDetailOpen ? "hidden xl:block" : ""}`}>
          <CreateClassPanel onCreated={loadClasses} />
          <ClassList
            classes={classes}
            selectedId={selectedId}
            selectedIds={selectedClassIds}
            onSelect={(id) => { setSelectedId(id); setMobileDetailOpen(true); }}
            onSelectionChange={setSelectedClassIds}
            onBulkAction={runBulkAction}
            bulkBusy={bulkBusy}
          />
        </aside>
        <main className={mobileDetailOpen ? "" : "hidden xl:block"}>
          <div className="xl:hidden mb-3">
            <MobileBackToList onBack={() => setMobileDetailOpen(false)} label="返回班級清單" />
          </div>
          {selectedId ? (
            <ClassWorkspace
              key={selectedId}
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
    </div>
  );
}
