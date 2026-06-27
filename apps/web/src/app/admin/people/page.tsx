"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminWorkbenchTabs from "@/components/admin/AdminWorkbenchTabs";
import {
  BadgeCheck,
  BookUser,
  BriefcaseBusiness,
  CalendarDays,
  CircleSlash,
  GraduationCap,
  Link2,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import MobileBackToList from "@/components/ui/MobileBackToList";
import { adminApi, ApiError, classApi, orgsApi, peopleApi, withFallback } from "@/lib/api";
import { today } from "@/lib/dateUtils";
import type {
  AdminUserDetail,
  OrgRead,
  PersonAffiliationCreate,
  PersonAffiliationKind,
  PersonAffiliationOut,
  PersonDetailOut,
  PersonListItem,
  PersonStatus,
  PositionSummary,
  SchoolClassListItem,
} from "@/lib/types";

const STATUS_LABEL: Record<PersonStatus, string> = {
  active: "在校",
  alumni: "校友",
  transferred: "轉出",
  inactive: "停用",
};

const KIND_LABEL: Record<PersonAffiliationKind, string> = {
  student: "學生身分",
  class_member: "分班名冊",
  class_role: "班級幹部",
  org_position: "自治組織幹部",
};

const CLASS_ROLE_OPTIONS = [
  { key: "class_representative", label: "班代" },
  { key: "class_leader", label: "班長" },
  { key: "vice_leader", label: "副班長" },
  { key: "discipline", label: "風紀" },
  { key: "lunch_manager", label: "午餐股長" },
  { key: "treasurer", label: "總務/收款" },
  { key: "general_affairs", label: "事務" },
];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function classLabel(item: SchoolClassListItem | { academic_year?: number | null; label?: string | null; class_code?: string | null }) {
  if ("class_code" in item && item.class_code) {
    return `${item.academic_year} 學年度 ${item.label ?? `${item.class_code} 班`}`;
  }
  return item.label ?? "未命名班級";
}

function roleTone(kind: PersonAffiliationKind) {
  if (kind === "class_member") return "#2563eb";
  if (kind === "class_role") return "#0f766e";
  if (kind === "org_position") return "#b45309";
  return "#64748b";
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`input ${props.className ?? ""}`}
      style={{ color: "var(--text-primary)", ...props.style }}
    />
  );
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`input ${props.className ?? ""}`}
      style={{ color: "var(--text-primary)", ...props.style }}
    />
  );
}

function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-md ${className}`} style={{ border: "1px solid var(--border)" }}>
      {children}
    </section>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
  tone = "neutral",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "neutral" | "primary" | "danger";
}) {
  const color = tone === "primary" ? "var(--primary)" : tone === "danger" ? "var(--danger)" : "var(--text-secondary)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      style={{ border: "1px solid var(--border)", color }}
    >
      {children}
    </button>
  );
}

export default function PeopleAdminPage() {
  const { can, isAdmin } = usePermissions();
  const allowed = isAdmin || can("admin:all") || can("admin:users") || can("class:manage") || can("org:manage_members");
  const [people, setPeople] = useState<PersonListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 手機版 master-detail：選取後切到詳情、未選顯示列表（桌機 xl 以上恆並排）。
  // 不能直接用 selectedId，因為列表載入會自動選第一筆，會害手機一進來就停在詳情。
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [detail, setDetail] = useState<PersonDetailOut | null>(null);
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [positions, setPositions] = useState<PositionSummary[]>([]);
  const [users, setUsers] = useState<AdminUserDetail[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PersonStatus | "">("");
  const [classId, setClassId] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAffiliation, setShowAffiliation] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const loadReference = useCallback(async () => {
    const [classRows, orgRows, positionRows, userRows] = await Promise.all([
      withFallback(classApi.list({ is_active: "true" }), []),
      withFallback(orgsApi.list({ active_only: true }), []),
      withFallback(adminApi.listPositions(), []),
      withFallback(adminApi.listUsers({ limit: 200 }), []),
    ]);
    setClasses(classRows);
    setOrgs(orgRows);
    setPositions(positionRows);
    setUsers(userRows);
  }, []);

  const loadPeople = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const rows = await peopleApi.list({
        keyword: query.trim() || undefined,
        status: status || undefined,
        class_id: classId || undefined,
        limit: 200,
      });
      setPeople(rows);
      setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
    } catch (error) {
      toast.error(errorMessage(error, "載入人員清單失敗"));
    } finally {
      setLoading(false);
    }
  }, [allowed, classId, query, status]);

  const loadDetail = useCallback(async (id: string | null) => {
    if (!id) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      setDetail(await peopleApi.get(id));
    } catch (error) {
      toast.error(errorMessage(error, "載入人員詳情失敗"));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    void loadReference();
  }, [allowed, loadReference]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPeople(), 200);
    return () => window.clearTimeout(timer);
  }, [loadPeople]);

  useEffect(() => {
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  const stats = useMemo(() => {
    const linked = people.filter((person) => person.user_id).length;
    const pending = people.reduce((sum, person) => sum + (person.role_titles.length > 0 && !person.user_id ? 1 : 0), 0);
    return {
      total: people.length,
      linked,
      pending,
      classed: people.filter((person) => person.class_labels.length > 0).length,
    };
  }, [people]);

  const refreshAll = async () => {
    await Promise.all([loadReference(), loadPeople()]);
    await loadDetail(selectedId);
  };

  if (!allowed) {
    return (
      <div className="py-24 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        需要人員、班級或組織成員管理權限才能使用此工作台。
      </div>
    );
  }

  return (
    <>
      <AdminWorkbenchTabs />
      <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-7xl flex-col gap-4 p-4 md:p-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase" style={{ color: "var(--primary)" }}>
            People Registry
          </p>
          <h1 className="mt-1 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
            人員與身分工作台
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <IconButton onClick={refreshAll}>
            <RefreshCcw size={14} /> 重新整理
          </IconButton>
          <IconButton onClick={() => setShowImport(true)} tone="primary">
            <Upload size={14} /> 匯入名冊
          </IconButton>
          <IconButton onClick={() => setShowCreate(true)} tone="primary">
            <Plus size={14} /> 新增人員
          </IconButton>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat icon={<UsersRound size={15} />} label="目前清單" value={stats.total} />
        <Stat icon={<Link2 size={15} />} label="已連帳號" value={stats.linked} />
        <Stat icon={<BookUser size={15} />} label="有分班" value={stats.classed} />
        <Stat icon={<CircleSlash size={15} />} label="待連帳號" value={stats.pending} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[24rem_1fr]">
        <Panel className={`min-h-[420px] flex-col overflow-hidden ${mobileDetailOpen ? "hidden xl:flex" : "flex"}`}>
          <div className="space-y-2 p-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-md px-3 py-2" style={{ border: "1px solid var(--border)" }}>
                <Search size={15} style={{ color: "var(--text-muted)" }} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-full bg-transparent text-sm outline-none"
                  placeholder="搜尋姓名、學號、Email"
                  style={{ color: "var(--text-primary)" }}
                />
              </div>
              <button
                type="button"
                onClick={() => setFilterOpen((v) => !v)}
                className="md:hidden inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2.5 py-2 text-xs font-medium"
                style={{
                  border: "1px solid var(--border)",
                  color: (status || classId) ? "var(--primary)" : "var(--text-muted)",
                  background: (status || classId) ? "var(--primary-dim)" : "transparent",
                }}
                aria-expanded={filterOpen}
              >
                <SlidersHorizontal size={13} />
                {(status || classId) ? "篩選中" : "篩選"}
              </button>
            </div>
            <div className={`grid grid-cols-2 gap-2 ${filterOpen ? "" : "hidden md:grid"}`}>
              <SelectInput value={status} onChange={(event) => setStatus(event.target.value as PersonStatus | "")}>
                <option value="">全部狀態</option>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </SelectInput>
              <SelectInput value={classId} onChange={(event) => setClassId(event.target.value)}>
                <option value="">全部班級</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>{classLabel(item)}</option>
                ))}
              </SelectInput>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <div className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>載入中...</div>
            ) : people.length === 0 ? (
              <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                找不到符合條件的人員。
              </div>
            ) : (
              people.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => { setSelectedId(person.id); setMobileDetailOpen(true); }}
                  className="w-full cursor-pointer px-4 py-3 text-left transition-colors"
                  style={{
                    borderBottom: "1px solid var(--border)",
                    background: selectedId === person.id ? "var(--primary-dim)" : "transparent",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                        {person.display_name}
                      </p>
                      <p className="mt-0.5 truncate text-xs" style={{ color: "var(--text-muted)" }}>
                        {person.student_id ?? "無學號"} · {person.email ?? "未填 Email"}
                      </p>
                    </div>
                    <span className="rounded px-2 py-0.5 text-[11px]" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                      {STATUS_LABEL[person.status]}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {person.class_labels.slice(0, 2).map((label) => (
                      <span key={label} className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>{label}</span>
                    ))}
                    {person.role_titles.slice(0, 2).map((label) => (
                      <span key={label} className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>{label}</span>
                    ))}
                  </div>
                </button>
              ))
            )}
          </div>
        </Panel>

        <Panel className={`min-h-[560px] overflow-hidden ${mobileDetailOpen ? "block" : "hidden xl:block"}`}>
          <div className="xl:hidden p-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <MobileBackToList onBack={() => setMobileDetailOpen(false)} label="返回人員列表" />
          </div>
          {detailLoading ? (
            <div className="p-8 text-sm" style={{ color: "var(--text-muted)" }}>載入人員詳情...</div>
          ) : detail ? (
            <PersonDetailPanel
              person={detail}
              users={users}
              onChanged={refreshAll}
              onAssign={() => setShowAffiliation(true)}
            />
          ) : (
            <div className="p-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              請先選擇一位人員。
            </div>
          )}
        </Panel>
      </div>

      {showCreate && (
        <CreatePersonDialog
          users={users}
          onClose={() => setShowCreate(false)}
          onDone={async (id) => {
            setShowCreate(false);
            await refreshAll();
            setSelectedId(id);
          }}
        />
      )}
      {showImport && (
        <ImportRosterDialog
          classes={classes}
          onClose={() => setShowImport(false)}
          onDone={async () => {
            setShowImport(false);
            await refreshAll();
          }}
        />
      )}
      {showAffiliation && detail && (
        <AffiliationDialog
          person={detail}
          classes={classes}
          orgs={orgs}
          positions={positions}
          onClose={() => setShowAffiliation(false)}
          onDone={async () => {
            setShowAffiliation(false);
            await refreshAll();
          }}
        />
      )}
    </div>
    </>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Panel className="p-3">
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        {icon}
        {label}
      </div>
      <p className="mt-1 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>{value}</p>
    </Panel>
  );
}

function PersonDetailPanel({
  person,
  users,
  onChanged,
  onAssign,
}: {
  person: PersonDetailOut;
  users: AdminUserDetail[];
  onChanged: () => Promise<void>;
  onAssign: () => void;
}) {
  const [edit, setEdit] = useState({
    display_name: person.display_name,
    student_id: person.student_id ?? "",
    email: person.email ?? "",
    status: person.status,
    user_id: person.user_id ?? "",
  });

  useEffect(() => {
    setEdit({
      display_name: person.display_name,
      student_id: person.student_id ?? "",
      email: person.email ?? "",
      status: person.status,
      user_id: person.user_id ?? "",
    });
  }, [person]);

  const active = person.affiliations.filter((item) => item.status !== "ended");
  const ended = person.affiliations.filter((item) => item.status === "ended");

  const save = async () => {
    try {
      await peopleApi.update(person.id, {
        display_name: edit.display_name,
        student_id: edit.student_id || null,
        email: edit.email || null,
        status: edit.status,
        user_id: edit.user_id || null,
      });
      toast.success("人員主檔已更新");
      await onChanged();
    } catch (error) {
      toast.error(errorMessage(error, "更新人員主檔失敗"));
    }
  };

  const syncPending = async () => {
    try {
      const result = await peopleApi.syncPending(person.id);
      toast.success(`已同步 ${result.synced} 筆待生效身分`);
      await onChanged();
    } catch (error) {
      toast.error(errorMessage(error, "同步失敗"));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="p-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <UserRound size={22} style={{ color: "var(--primary)" }} />
              <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                {person.display_name}
              </h2>
            </div>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {person.student_id ?? "無學號"} · {person.user_id ? "已連結平台帳號" : "尚未連結平台帳號"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <IconButton onClick={syncPending} disabled={!person.user_id}>
              <BadgeCheck size={14} /> 同步待生效
            </IconButton>
            <IconButton onClick={onAssign} tone="primary">
              <Plus size={14} /> 新增身分
            </IconButton>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs xl:col-span-2" style={{ color: "var(--text-muted)" }}>
            顯示姓名
            <TextInput className="mt-1" value={edit.display_name} onChange={(event) => setEdit({ ...edit, display_name: event.target.value })} />
          </label>
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>
            學號
            <TextInput className="mt-1" value={edit.student_id} onChange={(event) => setEdit({ ...edit, student_id: event.target.value })} />
          </label>
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>
            狀態
            <SelectInput className="mt-1" value={edit.status} onChange={(event) => setEdit({ ...edit, status: event.target.value as PersonStatus })}>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </SelectInput>
          </label>
          <div className="flex items-end">
            <IconButton onClick={save} tone="primary">
              <ShieldCheck size={14} /> 儲存
            </IconButton>
          </div>
          <label className="text-xs md:col-span-2 xl:col-span-3" style={{ color: "var(--text-muted)" }}>
            Email
            <TextInput className="mt-1" value={edit.email} onChange={(event) => setEdit({ ...edit, email: event.target.value })} />
          </label>
          <label className="text-xs md:col-span-2" style={{ color: "var(--text-muted)" }}>
            連結 User 帳號
            <SelectInput className="mt-1" value={edit.user_id} onChange={(event) => setEdit({ ...edit, user_id: event.target.value })}>
              <option value="">尚未連結</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name} · {user.student_id ?? user.email}
                </option>
              ))}
            </SelectInput>
          </label>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-5 xl:grid-cols-[1fr_18rem]">
        <div className="space-y-4">
          <AffiliationSection title="有效身分" items={active} onChanged={onChanged} />
          <AffiliationSection title="歷史紀錄" items={ended} onChanged={onChanged} muted />
        </div>
        <Panel className="h-fit p-4">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>資料索引</h3>
          <div className="mt-3 space-y-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            <IndexRow icon={<GraduationCap size={14} />} label="分班" value={active.filter((item) => item.kind === "class_member").map((item) => item.class_label ?? "未命名").join("、") || "無"} />
            <IndexRow icon={<BookUser size={14} />} label="班級職務" value={active.filter((item) => item.kind === "class_role").map((item) => item.title ?? item.role_key ?? "班級職務").join("、") || "無"} />
            <IndexRow icon={<BriefcaseBusiness size={14} />} label="自治職務" value={active.filter((item) => item.kind === "org_position").map((item) => `${item.org_name ?? ""}${item.position_name ? ` / ${item.position_name}` : ""}`).join("、") || "無"} />
            <IndexRow icon={<CalendarDays size={14} />} label="建立時間" value={new Date(person.created_at).toLocaleDateString("zh-TW")} />
          </div>
          <div className="mt-4 rounded-md p-3 text-xs" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
            新身分表是資料來源；需要權限的身分會同步成 UserPosition，供既有 RBAC 使用。
          </div>
        </Panel>
      </div>
    </div>
  );
}

function IndexRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2">
      <span className="inline-flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>{icon}{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

function AffiliationSection({
  title,
  items,
  onChanged,
  muted = false,
}: {
  title: string;
  items: PersonAffiliationOut[];
  onChanged: () => Promise<void>;
  muted?: boolean;
}) {
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h3>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>{items.length} 筆</span>
      </div>
      {items.length === 0 ? (
        <div className="p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>尚無資料。</div>
      ) : (
        <div>
          {items.map((item) => (
            <AffiliationRow key={item.id} item={item} muted={muted} onChanged={onChanged} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function AffiliationRow({
  item,
  muted,
  onChanged,
}: {
  item: PersonAffiliationOut;
  muted: boolean;
  onChanged: () => Promise<void>;
}) {
  const end = async () => {
    if (!confirm(`確定結束「${item.title ?? KIND_LABEL[item.kind]}」？`)) return;
    try {
      await peopleApi.endAffiliation(item.id);
      toast.success("身分已結束");
      await onChanged();
    } catch (error) {
      toast.error(errorMessage(error, "結束身分失敗"));
    }
  };
  const color = roleTone(item.kind);
  return (
    <div className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[1fr_auto]" style={{ borderBottom: "1px solid var(--border)", opacity: muted ? 0.7 : 1 }}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {item.title ?? item.position_name ?? item.role_key ?? KIND_LABEL[item.kind]}
          </p>
          <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: `${color}17`, color }}>
            {KIND_LABEL[item.kind]}
          </span>
          {item.status === "pending_user" && (
            <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ color: "var(--warning)", background: "var(--warning-dim)" }}>
              待連帳號
            </span>
          )}
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {[item.class_label, item.org_name, item.position_name].filter(Boolean).join(" · ") || "全域身分"}
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {item.start_date} 起 {item.end_date ? `至 ${item.end_date}` : "，目前有效"}
          {item.synced_user_position_id ? " · 已同步 RBAC" : ""}
        </p>
      </div>
      {!muted && (
        <div className="flex min-h-[44px] items-center justify-end">
          <IconButton onClick={end} tone="danger">
            <X size={14} /> 結束
          </IconButton>
        </div>
      )}
    </div>
  );
}

function CreatePersonDialog({
  users,
  onClose,
  onDone,
}: {
  users: AdminUserDetail[];
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [form, setForm] = useState({
    display_name: "",
    student_id: "",
    email: "",
    status: "active" as PersonStatus,
    user_id: "",
  });

  const submit = async () => {
    if (!form.display_name.trim()) {
      toast.error("請填寫姓名");
      return;
    }
    try {
      const created = await peopleApi.create({
        display_name: form.display_name.trim(),
        student_id: form.student_id.trim() || null,
        legal_name: null,
        email: form.email.trim() || null,
        status: form.status,
        note: null,
        user_id: form.user_id || null,
      });
      toast.success("人員已建立");
      onDone(created.id);
    } catch (error) {
      toast.error(errorMessage(error, "建立人員失敗"));
    }
  };

  return (
    <Dialog title="新增人員" onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="text-xs md:col-span-2" style={{ color: "var(--text-muted)" }}>
          姓名
          <TextInput className="mt-1" value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} />
        </label>
        <label className="text-xs" style={{ color: "var(--text-muted)" }}>
          學號
          <TextInput className="mt-1" value={form.student_id} onChange={(event) => setForm({ ...form, student_id: event.target.value })} />
        </label>
        <label className="text-xs" style={{ color: "var(--text-muted)" }}>
          狀態
          <SelectInput className="mt-1" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as PersonStatus })}>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </SelectInput>
        </label>
        <label className="text-xs md:col-span-2" style={{ color: "var(--text-muted)" }}>
          Email
          <TextInput className="mt-1" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </label>
        <label className="text-xs md:col-span-2" style={{ color: "var(--text-muted)" }}>
          可選：連結既有 User
          <SelectInput className="mt-1" value={form.user_id} onChange={(event) => setForm({ ...form, user_id: event.target.value })}>
            <option value="">不連結</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.display_name} · {user.student_id ?? user.email}</option>
            ))}
          </SelectInput>
        </label>
      </div>
      <DialogActions onCancel={onClose} onSubmit={submit} submitLabel="建立" />
    </Dialog>
  );
}

function ImportRosterDialog({
  classes,
  onClose,
  onDone,
}: {
  classes: SchoolClassListItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [classId, setClassId] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [raw, setRaw] = useState("學號,姓名,Email\n");

  const submit = async () => {
    const rows = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line, index) => !(index === 0 && line.includes("學號")))
      .map((line) => {
        const [studentId, name, email] = line.split(",").map((cell) => cell?.trim() ?? "");
        return {
          student_id: studentId,
          display_name: name,
          email: email || null,
          class_id: classId || null,
          academic_year: academicYear ? Number(academicYear) : null,
        };
      })
      .filter((row) => row.student_id && row.display_name);
    if (rows.length === 0) {
      toast.error("沒有可匯入的資料");
      return;
    }
    try {
      const result = await peopleApi.importRoster(rows);
      toast.success(`匯入 ${result.total} 筆，建立 ${result.people_created} 人，新增 ${result.affiliations_created} 筆分班`);
      onDone();
    } catch (error) {
      toast.error(errorMessage(error, "匯入名冊失敗"));
    }
  };

  return (
    <Dialog title="匯入全體學生 / 分班名單" onClose={onClose} maxWidth="max-w-3xl">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="text-xs" style={{ color: "var(--text-muted)" }}>
          指定班級
          <SelectInput className="mt-1" value={classId} onChange={(event) => setClassId(event.target.value)}>
            <option value="">只建立學生主檔</option>
            {classes.map((item) => (
              <option key={item.id} value={item.id}>{classLabel(item)}</option>
            ))}
          </SelectInput>
        </label>
        <label className="text-xs" style={{ color: "var(--text-muted)" }}>
          學年度
          <TextInput className="mt-1" value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} placeholder="例如 115" />
        </label>
        <label className="text-xs md:col-span-2" style={{ color: "var(--text-muted)" }}>
          CSV 內容
          <textarea
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            className="mt-1 h-72 w-full rounded-md border bg-transparent p-3 font-mono text-xs outline-none"
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          />
        </label>
      </div>
      <DialogActions onCancel={onClose} onSubmit={submit} submitLabel="匯入" />
    </Dialog>
  );
}

function AffiliationDialog({
  person,
  classes,
  orgs,
  positions,
  onClose,
  onDone,
}: {
  person: PersonDetailOut;
  classes: SchoolClassListItem[];
  orgs: OrgRead[];
  positions: PositionSummary[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<PersonAffiliationKind>("class_member");
  const [classId, setClassId] = useState("");
  const [orgId, setOrgId] = useState("");
  const [positionId, setPositionId] = useState("");
  const [roleKey, setRoleKey] = useState("class_representative");
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState("");

  const availablePositions = positions.filter((position) => !orgId || position.org_id === orgId);

  const submit = async () => {
    const payload: PersonAffiliationCreate = {
      person_id: person.id,
      kind,
      class_id: kind === "class_member" || kind === "class_role" ? classId || null : null,
      org_id: kind === "org_position" ? orgId || null : null,
      position_id: kind === "org_position" ? positionId || null : null,
      role_key: kind === "class_role" ? roleKey : null,
      title: title.trim() || null,
      start_date: startDate,
      end_date: endDate || null,
      source: "manual",
    };
    if ((kind === "class_member" || kind === "class_role") && !classId) {
      toast.error("請選擇班級");
      return;
    }
    if (kind === "org_position" && !positionId) {
      toast.error("請選擇自治組織職位");
      return;
    }
    try {
      await peopleApi.createAffiliation(payload);
      toast.success("身分已新增");
      onDone();
    } catch (error) {
      toast.error(errorMessage(error, "新增身分失敗"));
    }
  };

  return (
    <Dialog title={`新增 ${person.display_name} 的身分`} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {(Object.keys(KIND_LABEL) as PersonAffiliationKind[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setKind(item)}
              className="cursor-pointer rounded-md px-2 py-2 text-xs font-medium transition-colors"
              style={kind === item ? { background: "var(--primary-dim)", color: "var(--primary)" } : { border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              {KIND_LABEL[item]}
            </button>
          ))}
        </div>
        {(kind === "class_member" || kind === "class_role") && (
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>
            班級
            <SelectInput className="mt-1" value={classId} onChange={(event) => setClassId(event.target.value)}>
              <option value="">選擇班級</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>{classLabel(item)}</option>
              ))}
            </SelectInput>
          </label>
        )}
        {kind === "class_role" && (
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>
            班級職位
            <SelectInput className="mt-1" value={roleKey} onChange={(event) => setRoleKey(event.target.value)}>
              {CLASS_ROLE_OPTIONS.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </SelectInput>
          </label>
        )}
        {kind === "org_position" && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-xs" style={{ color: "var(--text-muted)" }}>
              組織
              <SelectInput className="mt-1" value={orgId} onChange={(event) => setOrgId(event.target.value)}>
                <option value="">全部組織</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </SelectInput>
            </label>
            <label className="text-xs" style={{ color: "var(--text-muted)" }}>
              職位
              <SelectInput className="mt-1" value={positionId} onChange={(event) => setPositionId(event.target.value)}>
                <option value="">選擇職位</option>
                {availablePositions.map((position) => (
                  <option key={position.id} value={position.id}>{position.org_name} · {position.name}</option>
                ))}
              </SelectInput>
            </label>
          </div>
        )}
        <label className="text-xs" style={{ color: "var(--text-muted)" }}>
          顯示職稱（選填）
          <TextInput className="mt-1" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>
            起始日
            <TextInput className="mt-1" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>
            結束日
            <TextInput className="mt-1" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
        </div>
      </div>
      <DialogActions onCancel={onClose} onSubmit={submit} submitLabel="新增身分" />
    </Dialog>
  );
}

function Dialog({
  title,
  children,
  onClose,
  maxWidth = "max-w-2xl",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  maxWidth?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.48)" }}>
      <div className={`max-h-[90vh] w-full ${maxWidth} overflow-auto rounded-md`} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
          <button type="button" onClick={onClose} className="cursor-pointer rounded p-1" style={{ color: "var(--text-muted)" }} aria-label="關閉">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
      </div>
    </div>
  );
}

function DialogActions({
  onCancel,
  onSubmit,
  submitLabel,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <IconButton onClick={onCancel}>取消</IconButton>
      <IconButton onClick={onSubmit} tone="primary">{submitLabel}</IconButton>
    </div>
  );
}
