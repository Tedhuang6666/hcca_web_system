"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import AdminWorkbenchTabs from "@/components/admin/AdminWorkbenchTabs";

import { ensurePermissionCatalog, PermCheckboxes } from "@/components/admin/PermissionCatalog";
import { today } from "@/lib/dateUtils";
import Modal from "@/components/ui/Modal";
import MobileBackToList from "@/components/ui/MobileBackToList";
import { adminApi, ApiError, apiErrorMessage, classApi, orgsApi, withFallback } from "@/lib/api";
import type { OrgRead } from "@/lib/api";
import type {
  AdminUserDetail,
  MeetingBillStage,
  PermissionCodeInfo,
  PositionCategory,
  PositionSummary,
  SchoolClassListItem,
  UserBatchPreRegisterResult,
} from "@/lib/types";
import { ListPageSkeleton } from "@/components/ui/Skeleton";

type Mode = "orgs" | "members" | "audit";
type OrgWithPermissionDefaults = OrgRead & { default_permission_codes: string[] };

// 組織在議事流程的角色：影響此組織所辦會議的議程是否自動偵測待審法案
const BILL_STAGE_OPTIONS: { value: "" | MeetingBillStage; label: string }[] = [
  { value: "", label: "一般組織（不審議法案）" },
  { value: "standing_committee", label: "常務委員會（審議新提案）" },
  { value: "council", label: "議會（審議常委會通過案）" },
];
type Detail = { type: "org"; id: string } | { type: "position"; id: string } | { type: "user"; id: string };
type ConfirmState = { title: string; body: string; action: () => Promise<unknown> } | null;

const POSITION_CATEGORY_LABEL: Record<PositionCategory, string> = {
  council: "自治職位",
  class: "班級職位",
  system: "系統職位",
};

const POSITION_CATEGORY_OPTIONS: { value: PositionCategory; label: string }[] = [
  { value: "council", label: "自治職位（班聯會 / 組織幹部）" },
  { value: "class", label: "班級職位（班級幹部）" },
  { value: "system", label: "系統職位（外部協作 / 特殊權限）" },
];

const highRisk = (code: string) =>
  code === "admin:all" ||
  code.includes("admin") ||
  code.includes("view_all") ||
  code.includes("delete") ||
  code.includes("publish") ||
  code.includes("issue_direct");

function uniquePositionsById(positions: PositionSummary[]) {
  return Array.from(new Map(positions.map((position) => [position.id, position])).values())
    .sort((a, b) => `${a.category} ${a.org_name} ${a.name}`.localeCompare(`${b.category} ${b.org_name} ${b.name}`, "zh-Hant"));
}

function parseBatchUsers(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [identifier = "", displayName = ""] = line
        .split(/[\t,，]/, 2)
        .map((value) => value.trim());
      return {
        line: index + 1,
        identifiers: identifier.split(";").map((value) => value.trim()).filter(Boolean),
        displayName,
        valid: Boolean(identifier && displayName),
      };
    });
}

function displayError(e: unknown, fallback: string) {
  toast.error(apiErrorMessage(e, fallback));
}

function Icon({ name }: { name: "org" | "users" | "shield" | "plus" | "search" | "edit" | "trash" }) {
  const common = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "users") return <svg {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
  if (name === "shield") return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>;
  if (name === "plus") return <svg {...common}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
  if (name === "edit") return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
  if (name === "trash") return <svg {...common}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>;
  return <svg {...common}><rect x="8" y="2" width="8" height="4" rx="1" /><rect x="1" y="14" width="6" height="4" rx="1" /><rect x="9" y="14" width="6" height="4" rx="1" /><rect x="17" y="14" width="6" height="4" rx="1" /><path d="M4 14v-3a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3" /><line x1="12" y1="6" x2="12" y2="10" /></svg>;
}

function SmallButton({
  children, onClick, tone = "neutral", disabled = false, title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "neutral" | "primary" | "danger" | "warning";
  disabled?: boolean;
  title?: string;
}) {
  const styles = {
    neutral: { color: "var(--text-secondary)", border: "1px solid var(--border)" },
    primary: { color: "var(--primary)", border: "1px solid var(--border-strong)", background: "var(--primary-dim)" },
    danger: { color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" },
    warning: { color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" },
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
      style={styles}
    >
      {children}
    </button>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full text-sm px-3 py-2 rounded-lg outline-none ${props.className ?? ""}`}
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)", ...props.style }}
    />
  );
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full text-sm px-3 py-2 rounded-lg outline-none ${props.className ?? ""}`}
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-secondary)", ...props.style }}
    />
  );
}

function Metric({ label, value, tone = "normal" }: { label: string; value: number | string; tone?: "normal" | "warning" }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="text-lg font-semibold mt-0.5" style={{ color: tone === "warning" ? "#f59e0b" : "var(--text-primary)" }}>{value}</p>
    </div>
  );
}

export default function PermissionsAdminPage() {
  const [users, setUsers] = useState<AdminUserDetail[]>([]);
  const [positions, setPositions] = useState<PositionSummary[]>([]);
  const [permCodes, setPermCodes] = useState<PermissionCodeInfo[]>([]);
  const [orgs, setOrgs] = useState<OrgWithPermissionDefaults[]>([]);
  const [classes, setClasses] = useState<SchoolClassListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("orgs");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [query, setQuery] = useState("");
  const [showWizard, setShowWizard] = useState(false);
  const [showNewOrg, setShowNewOrg] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const failedSections: string[] = [];
    const noteFailure = (label: string) => () => failedSections.push(label);
    const [loadedUsers, loadedPositions, loadedPerms, loadedOrgs, loadedClasses] = await Promise.all([
      withFallback(adminApi.listUsers({ limit: 200 }), [], noteFailure("使用者")),
      withFallback(adminApi.listPositions(), [], noteFailure("職位")),
      withFallback(adminApi.listPermissionCodes(), [], noteFailure("權限代碼")),
      withFallback(orgsApi.list({ active_only: true, exclude_class_orgs: true }), [], noteFailure("組織")),
      withFallback(classApi.list({ is_active: "true" }), [], noteFailure("班級")),
    ]);
    setUsers(loadedUsers);
    setPositions(loadedPositions);
    setPermCodes(ensurePermissionCatalog(loadedPerms));
    setOrgs(loadedOrgs as OrgWithPermissionDefaults[]);
    setClasses(loadedClasses);
    setDetail((current) => {
      const firstActiveOrg = loadedOrgs.find((org) => org.is_active) ?? loadedOrgs[0];
      if (!current && firstActiveOrg) return { type: "org", id: firstActiveOrg.id };
      if (current?.type === "org" && !loadedOrgs.some((o) => o.id === current.id)) return loadedOrgs[0] ? { type: "org", id: loadedOrgs[0].id } : null;
      if (current?.type === "position" && !loadedPositions.some((p) => p.id === current.id)) return loadedOrgs[0] ? { type: "org", id: loadedOrgs[0].id } : null;
      if (current?.type === "user" && !loadedUsers.some((u) => u.id === current.id)) return loadedOrgs[0] ? { type: "org", id: loadedOrgs[0].id } : null;
      return current;
    });
    if (failedSections.length) {
      toast.warning(`${failedSections.join("、")}暫時無法載入，其餘管理資料仍可使用`);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedOrgId = detail?.type === "org"
    ? detail.id
    : detail?.type === "position"
      ? positions.find((p) => p.id === detail.id)?.org_id
      : undefined;
  const selectedOrg = orgs.find((o) => o.id === selectedOrgId) ?? orgs[0] ?? null;
  const selectedPosition = detail?.type === "position" ? positions.find((p) => p.id === detail.id) ?? null : null;
  const selectedUser = detail?.type === "user" ? users.find((u) => u.id === detail.id) ?? null : null;
  const activeOrgs = orgs.filter((o) => o.is_active);
  const activePositions = positions.filter((p) => p.org_is_active);
  const orphanPositions = positions.filter((p) => !users.some((u) => u.positions.some((up) => up.id === p.id)));
  const noPermPositions = positions.filter((p) => p.permission_codes.length === 0);
  const riskyUsers = users.filter((u) => u.is_superuser || u.effective_permissions.some(highRisk));
  const expiringAssignments = users.flatMap((u) =>
    u.positions
      .filter((p) => {
        const end = p.user_position_id ? p : null;
        return Boolean(end);
      })
      .map((p) => ({ user: u, position: p })),
  );

  const runConfirm = async () => {
    if (!confirmState) return;
    try {
      const result = await confirmState.action();
      if (
        typeof result === "object"
        && result !== null
        && "keepOpen" in result
        && (result as { keepOpen?: boolean }).keepOpen
      ) return;
      setConfirmState(null);
      await load();
    } catch (e) {
      displayError(e, "操作失敗");
    }
  };
  const selectDetail = (next: Detail) => {
    setDetail(next);
    setMobileDetailOpen(typeof window !== "undefined" && window.innerWidth < 1024);
  };

  return (
    <div className="h-full flex flex-col" style={{ maxHeight: "calc(100vh - 4rem)" }}>
      <AdminWorkbenchTabs />
      <header className="flex flex-col items-stretch gap-3 px-4 py-4 flex-shrink-0 sm:flex-row sm:items-center sm:justify-between sm:px-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>自治管理工作台</h1>
          <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
            {loading ? "載入中..." : `${activeOrgs.length} 個有效組織 · ${orgs.length - activeOrgs.length} 個停用 · ${activePositions.length} 個可指派職位`}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <SmallButton onClick={() => setSidebarOpen(true)}><span className="sm:hidden">組織</span><span className="hidden sm:inline">選擇組織</span></SmallButton>
          <SmallButton onClick={() => setShowNewOrg(true)} tone="primary"><Icon name="plus" />新增組織</SmallButton>
          <Link
            href="/admin/permissions/positions/new"
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ color: "var(--primary)", border: "1px solid var(--border-strong)", background: "var(--primary-dim)" }}
          >
            <Icon name="plus" />建立職位
          </Link>
          <SmallButton onClick={() => setShowWizard(true)} tone="primary"><Icon name="users" />新人上任</SmallButton>
        </div>
      </header>

      {loading ? (
        <div className="flex-1 p-6">
          <ListPageSkeleton rows={6} showHeader={false} showFilters={false} />
        </div>
      ) : (
        <main className="flex-1 min-h-0 flex overflow-hidden relative">
          {sidebarOpen && <div className="fixed inset-0 z-30 sm:hidden" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setSidebarOpen(false)} />}
          <aside
            className={[
              "fixed sm:static inset-y-0 left-0 z-40 w-72 sm:w-64 flex-shrink-0 overflow-hidden transition-transform duration-200",
              sidebarOpen ? "translate-x-0" : "-translate-x-full sm:translate-x-0",
            ].join(" ")}
            style={{ background: "var(--bg-surface)", borderRight: "1px solid var(--border)" }}
          >
            <OrgWorkbenchSidebar
              orgs={orgs}
              positions={positions}
              users={users}
              selectedOrgId={selectedOrg?.id ?? null}
              selectedPositionId={selectedPosition?.id ?? null}
              onSelectOrg={(id) => { selectDetail({ type: "org", id }); setSidebarOpen(false); }}
              onSelectPosition={(id) => { selectDetail({ type: "position", id }); setSidebarOpen(false); }}
            />
          </aside>

          <section className={`w-full lg:w-[410px] xl:w-[470px] flex-shrink-0 overflow-hidden flex-col ${mobileDetailOpen ? "hidden lg:flex" : "flex"}`} style={{ borderRight: "1px solid var(--border)" }}>
            <div className="p-3 space-y-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="grid grid-cols-3 gap-1 rounded-xl p-1" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                {[
                  ["orgs", "組織架構", "org"],
                  ["members", "幹部任期", "users"],
                  ["audit", "權限稽核", "shield"],
                ].map(([key, label, icon]) => (
                  <button
                    key={key}
                    onClick={() => setMode(key as Mode)}
                    className="inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors"
                    style={mode === key ? { background: "var(--primary-dim)", color: "var(--primary)" } : { color: "var(--text-muted)" }}
                  >
                    <Icon name={icon as "org" | "users" | "shield"} />{label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40"><Icon name="search" /></span>
                <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋組織、職位、使用者或權限" className="pl-9" />
              </div>
            </div>
            <WorkbenchList
              mode={mode}
              query={query}
              org={selectedOrg}
              orgs={orgs}
              users={users}
              positions={positions}
              permCodes={permCodes}
              detail={detail}
              onSelect={selectDetail}
            />
          </section>

          <section className={`${mobileDetailOpen ? "flex" : "hidden"} lg:flex flex-1 min-w-0 flex-col overflow-y-auto`}>
            <div
              className="lg:hidden sticky top-0 z-10 flex-shrink-0 p-3"
              style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-surface)" }}
            >
              <MobileBackToList onBack={() => setMobileDetailOpen(false)} label="返回清單" />
            </div>
            <DetailPanel
              detail={detail}
              orgs={orgs}
              users={users}
              positions={positions}
              classes={classes}
              permCodes={permCodes}
              selectedOrg={selectedOrg}
              selectedPosition={selectedPosition}
              selectedUser={selectedUser}
              onRefresh={load}
              onSelect={selectDetail}
              onConfirm={setConfirmState}
              metrics={{ orphanPositions, noPermPositions, riskyUsers, expiringAssignments }}
            />
          </section>
        </main>
      )}

      {showNewOrg && <OrgCreateModal orgs={activeOrgs} onClose={() => setShowNewOrg(false)} onDone={() => { setShowNewOrg(false); load(); }} />}
      {showWizard && <OnboardingWizard users={users} positions={activePositions} orgs={activeOrgs} permCodes={permCodes} onClose={() => setShowWizard(false)} onDone={(close = true) => { if (close) setShowWizard(false); load(); }} />}
      {confirmState && (
        <Modal title={confirmState.title} onClose={() => setConfirmState(null)}>
          <p className="text-sm leading-6" style={{ color: "var(--text-secondary)" }}>{confirmState.body}</p>
          <div className="flex justify-end gap-2">
            <SmallButton onClick={() => setConfirmState(null)}>取消</SmallButton>
            <SmallButton onClick={runConfirm} tone="danger">確認</SmallButton>
          </div>
        </Modal>
      )}
    </div>
  );
}

function OrgWorkbenchSidebar({
  orgs, positions, users, selectedOrgId, selectedPositionId, onSelectOrg, onSelectPosition,
}: {
  orgs: OrgRead[];
  positions: PositionSummary[];
  users: AdminUserDetail[];
  selectedOrgId: string | null;
  selectedPositionId: string | null;
  onSelectOrg: (id: string) => void;
  onSelectPosition: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpanded(new Set(orgs.map((o) => o.id)));
  }, [orgs]);
  const childrenOf = (id: string | null) => orgs.filter((o) => o.parent_id === id);
  const countMembers = (positionId: string) => users.filter((u) => u.positions.some((p) => p.id === positionId)).length;
  const renderOrg = (org: OrgRead, depth = 0) => {
    const children = childrenOf(org.id);
    const orgPositions = positions.filter((p) => p.org_id === org.id);
    const open = expanded.has(org.id);
    return (
      <div key={org.id} style={{ paddingLeft: depth * 10 }}>
        <button
          onClick={() => {
            onSelectOrg(org.id);
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(org.id)) next.delete(org.id);
              else next.add(org.id);
              return next;
            });
          }}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left cursor-pointer transition-colors"
          style={{
            ...(selectedOrgId === org.id && !selectedPositionId
              ? { background: "var(--primary-dim)", color: "var(--primary)" }
              : { color: org.is_active ? "var(--text-secondary)" : "var(--text-muted)" }),
            opacity: org.is_active ? 1 : 0.62,
          }}
        >
          <span className="text-[10px]" style={{ transform: open ? "rotate(90deg)" : "none" }}>›</span>
          <span className="flex-1 truncate text-xs font-semibold">{org.name}</span>
          {!org.is_active && <span className="text-[10px]">停用</span>}
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>{orgPositions.length}</span>
        </button>
        {open && (
          <div className="ml-4 space-y-0.5">
            {orgPositions.map((position) => (
              <button
                key={position.id}
                onClick={() => onSelectPosition(position.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left cursor-pointer transition-colors"
                style={selectedPositionId === position.id ? { background: "var(--primary-dim)", color: "var(--primary)" } : { color: "var(--text-muted)" }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: selectedPositionId === position.id ? "var(--primary)" : "var(--border-strong)" }} />
                <span className="flex-1 truncate text-xs">
                  {position.name}
                  <span className="ml-1 text-[10px]" style={{ color: "var(--text-disabled)" }}>
                    {POSITION_CATEGORY_LABEL[position.category]}
                  </span>
                </span>
                <span className="text-[10px]">{countMembers(position.id)}</span>
              </button>
            ))}
            {children.map((child) => renderOrg(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 flex-shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>組織與職位</p>
        <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>停用組織保留歷史資料，但不會進入新建與指派流程。</p>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {childrenOf(null).map((org) => renderOrg(org))}
        {orgs.filter((o) => o.parent_id && !orgs.some((p) => p.id === o.parent_id)).map((org) => renderOrg(org))}
      </nav>
    </div>
  );
}

function WorkbenchList({
  mode, query, org, orgs, users, positions, permCodes, detail, onSelect,
}: {
  mode: Mode;
  query: string;
  org: OrgRead | null;
  orgs: OrgRead[];
  users: AdminUserDetail[];
  positions: PositionSummary[];
  permCodes: PermissionCodeInfo[];
  detail: Detail | null;
  onSelect: (detail: Detail) => void;
}) {
  const q = query.trim().toLowerCase();
  const filterText = (text: string) => !q || text.toLowerCase().includes(q);
  if (mode === "members") {
    const rows = users.filter((u) => filterText(`${u.display_name} ${u.email} ${u.student_id ?? ""} ${u.positions.map((p) => p.name).join(" ")}`));
    return (
      <div className="flex-1 overflow-y-auto">
        {rows.map((u) => (
          <button key={u.id} onClick={() => onSelect({ type: "user", id: u.id })} className="w-full flex items-start gap-3 px-4 py-3 text-left cursor-pointer transition-colors" style={detail?.type === "user" && detail.id === u.id ? { background: "var(--primary-dim)" } : { borderBottom: "1px solid var(--border)" }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: "var(--bg-elevated)", color: "var(--primary)" }}>{u.display_name.charAt(0)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{u.display_name}</p>
                {u.is_owner && <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ color: "#dc2626", background: "rgba(220,38,38,0.12)" }}>擁有者</span>}
                {u.is_superuser && !u.is_owner && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: "#f59e0b", background: "rgba(245,158,11,0.12)" }}>超管</span>}
                {!u.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: "#f87171", background: "rgba(248,113,113,0.1)" }}>停用</span>}
              </div>
              <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{u.email}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {u.positions.slice(0, 3).map((p) => <span key={p.user_position_id ?? p.id} className="text-[10px] px-1.5 py-0.5 rounded" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>{POSITION_CATEGORY_LABEL[p.category]} · {p.org_name} · {p.name}</span>)}
              </div>
            </div>
          </button>
        ))}
      </div>
    );
  }
  if (mode === "audit") {
    const matchingPerms = permCodes.filter((p) => filterText(`${p.group} ${p.label} ${p.code} ${p.desc}`));
    return (
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Metric label="高風險人員" value={users.filter((u) => u.is_superuser || u.effective_permissions.some(highRisk)).length} tone="warning" />
          <Metric label="無權限職位" value={positions.filter((p) => p.permission_codes.length === 0).length} />
          <Metric label="空職位" value={positions.filter((p) => !users.some((u) => u.positions.some((up) => up.id === p.id))).length} />
        </div>
        {matchingPerms.map((perm) => {
          const holderPositions = positions.filter((p) => p.permission_codes.includes(perm.code));
          const holders = users.filter((u) => u.effective_permissions.includes(perm.code));
          return (
            <div key={perm.code} className="rounded-xl p-3 space-y-2" style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{perm.label}</p>
                  <p className="text-[11px] font-mono" style={{ color: highRisk(perm.code) ? "#f59e0b" : "var(--text-muted)" }}>{perm.code}</p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>{holders.length} 人</span>
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{perm.desc}</p>
              <div className="flex flex-wrap gap-1">
                {holderPositions.slice(0, 5).map((p) => (
                  <button key={p.id} onClick={() => onSelect({ type: "position", id: p.id })} className="text-[10px] px-2 py-0.5 rounded-full cursor-pointer" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>{POSITION_CATEGORY_LABEL[p.category]} · {p.org_name} · {p.name}</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  const childCount = (orgId: string) => orgs.filter((item) => item.parent_id === orgId).length;
  const orgMemberCount = (orgId: string) => {
    const orgPositionIds = new Set(
      positions.filter((position) => position.org_id === orgId).map((position) => position.id),
    );
    return users.filter((user) => user.positions.some((position) => orgPositionIds.has(position.id))).length;
  };
  const depthOf = (target: OrgRead) => {
    let depth = 0;
    let parentId = target.parent_id;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = orgs.find((candidate) => candidate.id === parentId);
      if (!parent) break;
      depth += 1;
      parentId = parent.parent_id;
    }
    return depth;
  };
  const childrenOf = (parentId: string | null) =>
    orgs
      .filter((candidate) => candidate.parent_id === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  const visited = new Set<string>();
  const orderedOrgs: OrgRead[] = [];
  const appendBranch = (branch: OrgRead[]) => {
    branch.forEach((item) => {
      if (visited.has(item.id)) return;
      visited.add(item.id);
      orderedOrgs.push(item);
      appendBranch(childrenOf(item.id));
    });
  };
  appendBranch(childrenOf(null));
  appendBranch(
    orgs
      .filter((candidate) => candidate.parent_id && !orgs.some((parent) => parent.id === candidate.parent_id))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")),
  );
  const matchedOrgs = orderedOrgs.filter((item) =>
    filterText(`${item.name} ${item.description ?? ""} ${item.prefix ?? ""}`),
  );
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="rounded-xl p-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>組織總覽</p>
          <p className="text-base font-semibold mt-0.5" style={{ color: "var(--text-primary)" }}>
            {orgs.filter((item) => item.is_active).length} 個有效組織
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {orgs.filter((item) => !item.is_active).length} 個停用 · 目前選取：{org?.name ?? "未選擇"}
          </p>
        </div>
      </div>
      {matchedOrgs.map((item) => {
        const itemPositions = positions.filter((position) => position.org_id === item.id);
        const depth = depthOf(item);
        return (
          <button
            key={item.id}
            onClick={() => onSelect({ type: "org", id: item.id })}
            className="w-full px-4 py-3 text-left cursor-pointer transition-colors"
            style={{
              ...(detail?.type === "org" && detail.id === item.id
                ? { background: "var(--primary-dim)" }
                : { borderBottom: "1px solid var(--border)" }),
              paddingLeft: `${1 + depth * 0.75}rem`,
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{item.name}</p>
                {item.parent_id && (
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    階層 {depth + 1}
                  </p>
                )}
              </div>
              {!item.is_active && (
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}>
                  已停用
                </span>
              )}
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              {item.is_active ? "可建立與指派" : "僅保留歷史資料"} · {itemPositions.length} 個職位 · {orgMemberCount(item.id)} 位成員 · {childCount(item.id)} 個下層組織
            </p>
          </button>
        );
      })}
    </div>
  );
}

function DetailPanel({
  detail, orgs, users, positions, classes, permCodes, selectedOrg, selectedPosition, selectedUser,
  onRefresh, onSelect, onConfirm, metrics,
}: {
  detail: Detail | null;
  orgs: OrgRead[];
  users: AdminUserDetail[];
  positions: PositionSummary[];
  classes: SchoolClassListItem[];
  permCodes: PermissionCodeInfo[];
  selectedOrg: OrgWithPermissionDefaults | null;
  selectedPosition: PositionSummary | null;
  selectedUser: AdminUserDetail | null;
  onRefresh: () => Promise<void>;
  onSelect: (detail: Detail) => void;
  onConfirm: (state: ConfirmState) => void;
  metrics: {
    orphanPositions: PositionSummary[];
    noPermPositions: PositionSummary[];
    riskyUsers: AdminUserDetail[];
    expiringAssignments: { user: AdminUserDetail; position: PositionSummary }[];
  };
}) {
  if (detail?.type === "position" && selectedPosition) {
    return <PositionPanel position={selectedPosition} positions={positions} users={users} permCodes={permCodes} onRefresh={onRefresh} onSelect={onSelect} onConfirm={onConfirm} />;
  }
  if (detail?.type === "user" && selectedUser) {
    return <UserPanel user={selectedUser} positions={positions} classes={classes} permCodes={permCodes} onRefresh={onRefresh} onConfirm={onConfirm} />;
  }
  if (selectedOrg) {
    return <OrgPanel org={selectedOrg} orgs={orgs} positions={positions} users={users} permCodes={permCodes} onRefresh={onRefresh} onConfirm={onConfirm} metrics={metrics} />;
  }
  return <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>尚無可管理資料</div>;
}

function OrgPanel({
  org, orgs, positions, users, permCodes, onRefresh, onConfirm, metrics,
}: {
  org: OrgWithPermissionDefaults;
  orgs: OrgRead[];
  positions: PositionSummary[];
  users: AdminUserDetail[];
  permCodes: PermissionCodeInfo[];
  onRefresh: () => Promise<void>;
  onConfirm: (state: ConfirmState) => void;
  metrics: {
    orphanPositions: PositionSummary[];
    noPermPositions: PositionSummary[];
    riskyUsers: AdminUserDetail[];
    expiringAssignments: { user: AdminUserDetail; position: PositionSummary }[];
  };
}) {
  const [name, setName] = useState(org.name);
  const [description, setDescription] = useState(org.description ?? "");
  const [prefix, setPrefix] = useState(org.prefix ?? "");
  const [billStage, setBillStage] = useState<"" | MeetingBillStage>(org.bill_stage ?? "");
  const [parentId, setParentId] = useState(org.parent_id ?? "");
  const [leaderUserId, setLeaderUserId] = useState(org.leader_user_id ?? "");
  const [defaultCodes, setDefaultCodes] = useState<string[]>(org.default_permission_codes ?? []);
  const orgPositions = positions.filter((p) => p.org_id === org.id);
  const orgMembers = users.filter((u) => orgPositions.some((p) => u.positions.some((up) => up.id === p.id)));
  const fallbackLeader = orgMembers
    .map((user) => {
      const maxWeight = Math.max(
        ...user.positions
          .filter((position) => position.org_id === org.id)
          .map((position) => position.weight),
        0,
      );
      return { user, maxWeight };
    })
    .sort((a, b) => b.maxWeight - a.maxWeight || a.user.display_name.localeCompare(b.user.display_name, "zh-Hant"))[0]?.user;
  const descendantIds = new Set<string>();
  const collectDescendants = (parentId: string) => {
    orgs.filter((o) => o.parent_id === parentId).forEach((child) => {
      if (descendantIds.has(child.id)) return;
      descendantIds.add(child.id);
      collectDescendants(child.id);
    });
  };
  collectDescendants(org.id);
  const childCount = orgs.filter((o) => o.parent_id === org.id).length;

  useEffect(() => {
    setName(org.name);
    setDescription(org.description ?? "");
    setPrefix(org.prefix ?? "");
    setBillStage(org.bill_stage ?? "");
    setParentId(org.parent_id ?? "");
    setLeaderUserId(org.leader_user_id ?? "");
    setDefaultCodes(org.default_permission_codes ?? []);
  }, [org]);

  const save = async () => {
    try {
      await adminApi.updateOrg(org.id, {
        name: name.trim(),
        description: description.trim() || null,
        prefix: prefix.trim() || null,
        bill_stage: billStage || null,
        parent_id: parentId || null,
        leader_user_id: leaderUserId || null,
        default_permission_codes: defaultCodes,
      });
      toast.success("組織已更新");
      await onRefresh();
    } catch (e) {
      displayError(e, "更新組織失敗");
    }
  };
  const confirmDeactivate = () => {
    onConfirm({
      title: "停用組織",
      body: `停用「${org.name}」後，既有公文與法規會保留，但新建公文、法規與字號範本時不再列為可選組織。`,
      action: async () => {
        await adminApi.deactivateOrg(org.id);
        toast.success("組織已停用");
      },
    });
  };
  const confirmActivate = () => {
    onConfirm({
      title: "啟用組織",
      body: `確定重新啟用「${org.name}」？啟用後會再次出現在新建流程的組織選單。`,
      action: async () => {
        await adminApi.activateOrg(org.id);
        toast.success("組織已啟用");
      },
    });
  };
  const confirmDelete = () => {
    onConfirm({
      title: "刪除組織",
      body: `確定刪除「${org.name}」？此組織目前有 ${orgPositions.length} 個職位、${orgMembers.length} 位成員與 ${childCount} 個直屬下層組織。若仍關聯公文或法規，系統會引導改為停用。`,
      action: async () => {
        try {
          await adminApi.deleteOrg(org.id);
          toast.success("組織已刪除");
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            onConfirm({
              title: "改為停用組織",
              body: `${e.message}。是否現在停用「${org.name}」？`,
              action: async () => {
                await adminApi.deactivateOrg(org.id);
                toast.success("組織已停用");
              },
            });
            return { keepOpen: true };
          }
          throw e;
        }
      },
    });
  };
  return (
    <div className="w-full p-5 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>組織架構</p>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <h2 className="text-xl font-semibold break-words" style={{ color: "var(--text-primary)" }}>{org.name}</h2>
            {!org.is_active && (
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: "#f59e0b", border: "1px solid rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.12)" }}>
                已停用
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {org.is_active ? (
            <SmallButton tone="warning" onClick={confirmDeactivate}>停用</SmallButton>
          ) : (
            <SmallButton tone="primary" onClick={confirmActivate}>啟用</SmallButton>
          )}
          <SmallButton tone="danger" onClick={confirmDelete}><Icon name="trash" />刪除</SmallButton>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="職位" value={orgPositions.length} />
        <Metric label="成員" value={orgMembers.length} />
        <Metric label="空職位" value={metrics.orphanPositions.filter((p) => p.org_id === org.id).length} />
        <Metric label="高風險人員" value={metrics.riskyUsers.filter((u) => orgMembers.some((m) => m.id === u.id)).length} tone="warning" />
      </div>
      <section className="rounded-xl p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>組織資料</h3>
          <SmallButton onClick={save} tone="primary"><Icon name="edit" />儲存</SmallButton>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>名稱<TextInput value={name} onChange={(e) => setName(e.target.value)} className="mt-1" /></label>
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>字號前綴<TextInput value={prefix} onChange={(e) => setPrefix(e.target.value)} className="mt-1" placeholder="例：嶺代" /></label>
          <label className="text-xs sm:col-span-2" style={{ color: "var(--text-muted)" }}>議事角色（法案審議階段）<SelectInput value={billStage} onChange={(e) => setBillStage(e.target.value as "" | MeetingBillStage)} className="mt-1">{BILL_STAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</SelectInput><span className="block mt-1 text-[10px]" style={{ color: "var(--text-disabled)" }}>設定後，此組織所辦會議的議程會自動偵測對應階段的待審法案。</span></label>
          <label className="text-xs sm:col-span-2" style={{ color: "var(--text-muted)" }}>描述<TextInput value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" /></label>
          <label className="text-xs sm:col-span-2" style={{ color: "var(--text-muted)" }}>上層組織<SelectInput value={parentId} onChange={(e) => setParentId(e.target.value)} className="mt-1"><option value="">無（頂層）</option>{orgs.filter((o) => o.is_active && o.id !== org.id && !descendantIds.has(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</SelectInput></label>
          <label className="text-xs sm:col-span-2" style={{ color: "var(--text-muted)" }}>
            部長 / 最高權限者
            <SelectInput value={leaderUserId} onChange={(e) => setLeaderUserId(e.target.value)} className="mt-1">
              <option value="">
                未指定（預設：{fallbackLeader?.display_name ?? "同組織最高權重成員"}）
              </option>
              {orgMembers.map((member) => (
                <option key={member.id} value={member.id}>{member.display_name} · {member.email}</option>
              ))}
            </SelectInput>
          </label>
        </div>
      </section>
      <section className="rounded-xl p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>組織預設權限</h3>
            <p className="text-xs mt-1 max-w-2xl" style={{ color: "var(--text-muted)" }}>
              建立職位時會先套用這組權限，再由職位頁面增加或移除個別權限。變更只影響之後建立的職位。
            </p>
          </div>
          <SmallButton onClick={save} tone="primary">儲存預設</SmallButton>
        </div>
        <PermCheckboxes selected={defaultCodes} onChange={setDefaultCodes} permCodes={permCodes} />
      </section>
      <section className="rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" style={{ border: "1px solid var(--border)", background: "var(--primary-dim)" }}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>建立這個組織的職位</h3>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>從組織預設開始，清楚調整分類、權重與職位專屬權限。</p>
        </div>
        <Link
          href={`/admin/permissions/positions/new?org_id=${org.id}`}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 px-3 rounded-lg text-xs font-semibold whitespace-nowrap"
          style={{ color: "var(--primary-contrast, white)", background: "var(--primary)" }}
        >
          <Icon name="plus" />前往建立職位
        </Link>
      </section>
    </div>
  );
}

function PositionPanel({
  position, positions, users, permCodes, onRefresh, onSelect, onConfirm,
}: {
  position: PositionSummary;
  positions: PositionSummary[];
  users: AdminUserDetail[];
  permCodes: PermissionCodeInfo[];
  onRefresh: () => Promise<void>;
  onSelect: (detail: Detail) => void;
  onConfirm: (state: ConfirmState) => void;
}) {
  const [name, setName] = useState(position.name);
  const [description, setDescription] = useState(position.description ?? "");
  const [category, setCategory] = useState<PositionCategory>(position.category);
  const [weight, setWeight] = useState(position.weight);
  const [parentId, setParentId] = useState(position.parent_id ?? "");
  const [codes, setCodes] = useState(position.permission_codes);
  const [memberUserId, setMemberUserId] = useState("");
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState("");
  const orgPositions = positions.filter((p) => p.org_id === position.org_id && p.id !== position.id);
  const members = users.filter((u) => u.positions.some((p) => p.id === position.id));
  const candidates = users.filter((u) => !members.some((m) => m.id === u.id));

  useEffect(() => {
    setName(position.name);
    setDescription(position.description ?? "");
    setCategory(position.category);
    setWeight(position.weight);
    setParentId(position.parent_id ?? "");
    setCodes(position.permission_codes);
  }, [position]);

  const save = async () => {
    try {
      await adminApi.updatePosition(position.id, { name: name.trim(), description: description.trim() || null, category, weight, parent_id: parentId || null });
      await adminApi.replacePositionPermissions(position.id, codes);
      toast.success("職位已更新");
      await onRefresh();
    } catch (e) {
      displayError(e, "更新職位失敗");
    }
  };
  const addMember = async () => {
    if (!position.org_is_active) {
      toast.error("此職位所屬組織已停用，無法新增任期");
      return;
    }
    if (!memberUserId) {
      toast.error("請選擇成員");
      return;
    }
    try {
      await adminApi.addUserPosition(memberUserId, { position_id: position.id, start_date: startDate, end_date: endDate || null });
      toast.success("成員已新增");
      setMemberUserId("");
      setEndDate("");
      await onRefresh();
    } catch (e) {
      displayError(e, "新增成員失敗");
    }
  };
  return (
    <div className="w-full p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>職位 / 幹部</p>
          <h2 className="text-xl font-semibold mt-1" style={{ color: "var(--text-primary)" }}>{position.name}</h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{POSITION_CATEGORY_LABEL[position.category]} · {position.org_name} · {members.length} 位成員 · {position.permission_codes.length} 個權限</p>
          {!position.org_is_active && (
            <p className="text-xs mt-1" style={{ color: "#f59e0b" }}>所屬組織已停用：只保留既有任期，不可新增指派。</p>
          )}
        </div>
        <SmallButton
          tone="danger"
          onClick={() => onConfirm({
            title: "刪除職位",
            body: `確定刪除「${position.name}」？目前 ${members.length} 位成員會失去此職位任期。`,
            action: () => adminApi.deletePosition(position.id),
          })}
        >
          <Icon name="trash" />刪除
        </SmallButton>
      </div>
      <section className="rounded-xl p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>職位資料與權限</h3>
          <SmallButton onClick={save} tone="primary">儲存變更</SmallButton>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>名稱<TextInput value={name} onChange={(e) => setName(e.target.value)} className="mt-1" /></label>
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>分類<SelectInput value={category} onChange={(e) => setCategory(e.target.value as PositionCategory)} className="mt-1">{POSITION_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</SelectInput></label>
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>權限係數<TextInput type="number" min={0} value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="mt-1" /></label>
          <label className="text-xs sm:col-span-2" style={{ color: "var(--text-muted)" }}>描述<TextInput value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" /></label>
          <label className="text-xs sm:col-span-2" style={{ color: "var(--text-muted)" }}>上級職位<SelectInput value={parentId} onChange={(e) => setParentId(e.target.value)} className="mt-1"><option value="">無上級</option>{orgPositions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectInput></label>
        </div>
        <PermCheckboxes selected={codes} onChange={setCodes} permCodes={permCodes} />
      </section>
      <section className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-4 py-3" style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>成員任期</h3>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-[1fr_130px_130px_auto] gap-2 items-end" style={{ borderBottom: "1px solid var(--border)" }}>
          <SelectInput value={memberUserId} onChange={(e) => setMemberUserId(e.target.value)} disabled={!position.org_is_active}><option value="">選擇新增成員</option>{candidates.map((u) => <option key={u.id} value={u.id}>{u.display_name} · {u.email}</option>)}</SelectInput>
          <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ colorScheme: "dark" }} />
          <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ colorScheme: "dark" }} />
          <SmallButton onClick={addMember} tone="primary" disabled={!position.org_is_active}>新增</SmallButton>
        </div>
        {members.map((u) => <AssignmentRow key={u.id} user={u} positionId={position.id} onRefresh={onRefresh} onSelect={onSelect} onConfirm={onConfirm} />)}
      </section>
    </div>
  );
}

function AssignmentRow({
  user, positionId, onRefresh, onSelect, onConfirm,
}: {
  user: AdminUserDetail;
  positionId: string;
  onRefresh: () => Promise<void>;
  onSelect: (detail: Detail) => void;
  onConfirm: (state: ConfirmState) => void;
}) {
  const assignment = user.positions.find((p) => p.id === positionId);
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState("");
  if (!assignment?.user_position_id) return null;
  const save = async () => {
    try {
      await adminApi.updateUserPosition(user.id, assignment.user_position_id!, { start_date: start, end_date: end || null });
      toast.success("任期已更新");
      await onRefresh();
    } catch (e) {
      displayError(e, "更新任期失敗");
    }
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_130px_130px_auto_auto] gap-2 items-center px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
      <button onClick={() => onSelect({ type: "user", id: user.id })} className="text-left min-w-0 cursor-pointer">
        <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{user.display_name}</p>
        <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{user.email}</p>
      </button>
      <TextInput type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ colorScheme: "dark" }} />
      <TextInput type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={{ colorScheme: "dark" }} />
      <SmallButton onClick={save}>儲存</SmallButton>
      <SmallButton
        tone="danger"
        onClick={() => onConfirm({
          title: "移除職位任期",
          body: `確定移除「${user.display_name}」的「${assignment.name}」任期？`,
          action: () => adminApi.removeUserPosition(user.id, assignment.user_position_id!),
        })}
      >
        移除
      </SmallButton>
    </div>
  );
}

function UserPanel({
  user, positions, classes, permCodes, onRefresh, onConfirm,
}: {
  user: AdminUserDetail;
  positions: PositionSummary[];
  classes: SchoolClassListItem[];
  permCodes: PermissionCodeInfo[];
  onRefresh: () => Promise<void>;
  onConfirm: (state: ConfirmState) => void;
}) {
  const [positionId, setPositionId] = useState("");
  const [classId, setClassId] = useState("");
  const [asCadre, setAsCadre] = useState(false);
  const [emailAlias, setEmailAlias] = useState("");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState("");
  const available = uniquePositionsById(positions)
    .filter((p) => p.org_is_active)
    .filter((p) => !user.positions.some((up) => up.id === p.id));
  const add = async () => {
    if (!positionId) return;
    try {
      await adminApi.addUserPosition(user.id, { position_id: positionId, start_date: start, end_date: end || null });
      toast.success("職位已指派");
      setPositionId("");
      await onRefresh();
    } catch (e) {
      displayError(e, "指派職位失敗");
    }
  };
  const addClassMember = async () => {
    if (!classId) return;
    try {
      await classApi.addMember(classId, user.id);
      if (asCadre) await classApi.addCadre(classId, user.id);
      toast.success(asCadre ? "已加入班級並設定為班級幹部" : "已加入班級");
      setClassId("");
      setAsCadre(false);
      await onRefresh();
    } catch (e) {
      displayError(e, "加入班級失敗");
    }
  };
  const addEmailAlias = async () => {
    const emails = emailAlias.split(/[,，;\s]+/).map((value) => value.trim()).filter(Boolean);
    if (emails.length === 0) return;
    try {
      await adminApi.linkUserEmails(user.id, emails);
      toast.success("登入 Email 已連結");
      setEmailAlias("");
      await onRefresh();
    } catch (e) {
      displayError(e, "連結 Email 失敗");
    }
  };
  return (
    <div className="w-full p-5 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>幹部任期</p>
          <h2 className="text-xl font-semibold mt-1 break-words" style={{ color: "var(--text-primary)" }}>
            {user.display_name}
          </h2>
          <div className="mt-2 space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <p className="break-all">主要 Email：{user.email}</p>
            <p className="break-all">
              登入 Email：{user.linked_emails.length > 0 ? user.linked_emails.join("、") : user.email}
            </p>
            <p>學號：{user.student_id ?? "未設定"}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <SmallButton
            tone={user.is_active ? "danger" : "primary"}
            disabled={user.is_owner && user.is_active}
            title={user.is_owner && user.is_active ? "Owner 帳號不可停用" : undefined}
            onClick={() => onConfirm({
              title: user.is_active ? "停用帳號" : "啟用帳號",
              body: `確定要${user.is_active ? "停用" : "啟用"}「${user.display_name}」？`,
              action: () => adminApi.updateUser(user.id, { is_active: !user.is_active }),
            })}
          >
            {user.is_active ? "停用" : "啟用"}
          </SmallButton>
          <SmallButton
            tone="warning"
            disabled={user.is_owner && user.is_superuser}
            title={user.is_owner && user.is_superuser ? "Owner 帳號不可移除超管身分" : undefined}
            onClick={() => onConfirm({
              title: user.is_superuser ? "取消超管" : "設定超管",
              body: `確定要${user.is_superuser ? "取消" : "賦予"}「${user.display_name}」超級管理員權限？此權限會跳過所有 RBAC 檢查。`,
              action: () => adminApi.updateUser(user.id, { is_superuser: !user.is_superuser }),
            })}
          >
            {user.is_superuser ? "取消超管" : "設超管"}
          </SmallButton>
        </div>
      </div>
      <section className="rounded-xl p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            連結其他登入 Email
          </h3>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            可連結私人或其他校務信箱；使用任一已連結 Google 帳號登入都會進入同一帳戶。
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
          <TextInput
            value={emailAlias}
            onChange={(event) => setEmailAlias(event.target.value)}
            placeholder="name@gmail.com，可用逗號分隔多筆"
          />
          <SmallButton onClick={addEmailAlias} tone="primary" disabled={!emailAlias.trim()}>
            連結 Email
          </SmallButton>
        </div>
      </section>
      <section className="rounded-xl p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>指派新職位</h3>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_130px_130px_auto] gap-2 items-end">
          <SelectInput value={positionId} onChange={(e) => setPositionId(e.target.value)}><option value="">選擇職位（套用職位權限）</option>{available.map((p) => <option key={p.id} value={p.id}>{POSITION_CATEGORY_LABEL[p.category]} · {p.org_name} · {p.name}</option>)}</SelectInput>
          <TextInput type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ colorScheme: "dark" }} />
          <TextInput type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={{ colorScheme: "dark" }} />
          <SmallButton onClick={add} tone="primary">指派</SmallButton>
        </div>
      </section>
      <section className="rounded-xl p-4 space-y-3" style={{ border: "1px solid var(--border)" }}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            加入班級
          </h3>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            手動加入班級不會修改學號；勾選班級幹部後，該使用者可管理本班訂單與繳費狀態。
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-center">
          <SelectInput value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">選擇班級</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.academic_year} 學年度 · {c.label ?? `${c.class_code} 班`}
              </option>
            ))}
          </SelectInput>
          <label className="flex items-center gap-2 text-xs px-2" style={{ color: "var(--text-muted)" }}>
            <input
              type="checkbox"
              checked={asCadre}
              onChange={(e) => setAsCadre(e.target.checked)}
            />
            設為班級幹部
          </label>
          <SmallButton onClick={addClassMember} tone="primary" disabled={!classId}>
            加入
          </SmallButton>
        </div>
      </section>
      <section className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="px-4 py-3" style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>目前任期</h3>
        </div>
        {user.positions.map((p) => <UserAssignmentEditor key={p.user_position_id ?? p.id} user={user} position={p} onRefresh={onRefresh} onConfirm={onConfirm} />)}
      </section>
      <section className="rounded-xl p-4 space-y-2" style={{ border: "1px solid var(--border)" }}>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>有效權限來源</h3>
        <div className="flex flex-wrap gap-1.5">
          {user.is_superuser ? (
            <span className="text-xs px-2 py-1 rounded" style={{ color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}>超管：所有權限</span>
          ) : user.effective_permissions.map((code) => {
            const info = permCodes.find((p) => p.code === code);
            return <span key={code} title={code} className="text-xs px-2 py-1 rounded" style={{ color: highRisk(code) ? "#f59e0b" : "var(--primary)", border: "1px solid var(--border-strong)", background: highRisk(code) ? "rgba(245,158,11,0.12)" : "var(--primary-dim)" }}>{info?.label ?? code}</span>;
          })}
        </div>
      </section>
    </div>
  );
}

function UserAssignmentEditor({
  user, position, onRefresh, onConfirm,
}: {
  user: AdminUserDetail;
  position: PositionSummary;
  onRefresh: () => Promise<void>;
  onConfirm: (state: ConfirmState) => void;
}) {
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState("");
  if (!position.user_position_id) return null;
  const save = async () => {
    try {
      await adminApi.updateUserPosition(user.id, position.user_position_id!, { start_date: start, end_date: end || null });
      toast.success("任期已更新");
      await onRefresh();
    } catch (e) {
      displayError(e, "更新任期失敗");
    }
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_130px_130px_auto_auto] gap-2 items-center px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{POSITION_CATEGORY_LABEL[position.category]} · {position.org_name} · {position.name}</p>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{position.permission_codes.length} 個權限</p>
      </div>
      <TextInput type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ colorScheme: "dark" }} />
      <TextInput type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={{ colorScheme: "dark" }} />
      <SmallButton onClick={save}>儲存</SmallButton>
      <SmallButton
        tone="danger"
        onClick={() => onConfirm({
          title: "移除職位任期",
          body: `確定移除「${user.display_name}」的「${position.name}」任期？`,
          action: () => adminApi.removeUserPosition(user.id, position.user_position_id!),
        })}
      >
        移除
      </SmallButton>
    </div>
  );
}

function OrgCreateModal({ orgs, onClose, onDone }: { orgs: OrgRead[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prefix, setPrefix] = useState("");
  const [billStage, setBillStage] = useState<"" | MeetingBillStage>("");
  const [parentId, setParentId] = useState("");
  const submit = async () => {
    if (!name.trim()) {
      toast.error("請填寫組織名稱");
      return;
    }
    try {
      await adminApi.createOrg({ name: name.trim(), description: description.trim() || undefined, prefix: prefix.trim() || null, bill_stage: billStage || null, parent_id: parentId || null });
      toast.success("組織已建立");
      onDone();
    } catch (e) {
      displayError(e, "建立組織失敗");
    }
  };
  return (
    <Modal title="新增組織" onClose={onClose}>
      <div className="space-y-3">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="組織名稱" />
        <TextInput value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="字號前綴（選填）" />
        <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="描述（選填）" />
        <SelectInput value={billStage} onChange={(e) => setBillStage(e.target.value as "" | MeetingBillStage)}>{BILL_STAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</SelectInput>
        <SelectInput value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">無上層組織</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</SelectInput>
      </div>
      <div className="flex justify-end gap-2">
        <SmallButton onClick={onClose}>取消</SmallButton>
        <SmallButton onClick={submit} tone="primary">建立</SmallButton>
      </div>
    </Modal>
  );
}

function OnboardingWizard({
  users, positions, orgs, permCodes, onClose, onDone,
}: {
  users: AdminUserDetail[];
  positions: PositionSummary[];
  orgs: OrgRead[];
  permCodes: PermissionCodeInfo[];
  onClose: () => void;
  onDone: (close?: boolean) => void;
}) {
  const [mode, setMode] = useState<"new" | "batch" | "existing">("new");
  const [userId, setUserId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [email, setEmail] = useState("");
  const [linkedEmails, setLinkedEmails] = useState("");
  const [name, setName] = useState("");
  const [positionId, setPositionId] = useState("");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState("");
  const [customOrgId, setCustomOrgId] = useState("");
  const [customCodes, setCustomCodes] = useState<string[]>([]);
  const [batchInput, setBatchInput] = useState("");
  const [batchResult, setBatchResult] = useState<UserBatchPreRegisterResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const uniquePositions = uniquePositionsById(positions);
  const selectedPosition = uniquePositions.find((p) => p.id === positionId);
  const previewCodes = Array.from(new Set([...(selectedPosition?.permission_codes ?? []), ...customCodes]));
  const batchUsers = useMemo(() => parseBatchUsers(batchInput), [batchInput]);
  const invalidBatchUsers = batchUsers.filter((user) => !user.valid);
  const submit = async () => {
    setSubmitting(true);
    try {
      if (mode === "existing") {
        if (!userId || !positionId) {
          toast.error("請選擇使用者與職位");
          return;
        }
        await adminApi.addUserPosition(userId, { position_id: positionId, start_date: start, end_date: end || null });
      } else if (mode === "new") {
        if (!name.trim() || (!studentId.trim() && !email.trim())) {
          toast.error("請填寫姓名，並提供學號或 Email");
          return;
        }
        await adminApi.preRegister({
          display_name: name.trim(),
          student_id: studentId.trim() || null,
          email: email.trim() || null,
          linked_emails: linkedEmails.split(/[,，;\s]+/).map((value) => value.trim()).filter(Boolean),
          position_ids: positionId ? [positionId] : [],
          start_date: start,
          end_date: end || null,
          custom_permission_org_id: customCodes.length > 0 ? customOrgId || null : null,
          custom_permission_codes: customCodes,
        });
      } else {
        if (batchUsers.length === 0) {
          toast.error("請貼上至少一筆帳號資料");
          return;
        }
        if (batchUsers.length > 200) {
          toast.error("單次最多建立 200 筆帳號");
          return;
        }
        if (invalidBatchUsers.length > 0) {
          toast.error(`第 ${invalidBatchUsers.map((user) => user.line).join("、")} 列格式不完整`);
          return;
        }
        const result = await adminApi.batchPreRegister({
          users: batchUsers.map((user) => ({
            display_name: user.displayName,
            student_id: user.identifiers[0]?.includes("@") ? null : user.identifiers[0],
            email: user.identifiers[0]?.includes("@") ? user.identifiers[0] : null,
            linked_emails: user.identifiers.slice(1),
            position_ids: positionId ? [positionId] : [],
            start_date: start,
            end_date: end || null,
          })),
        });
        setBatchResult(result);
        if (result.failed > 0) {
          toast.warning(`已建立 ${result.created} 筆，${result.failed} 筆需要修正`);
          await onDone(false);
          return;
        }
      }
      toast.success("新人上任流程已完成");
      onDone();
    } catch (e) {
      displayError(e, "新人上任流程失敗");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Modal title="新人上任 Wizard" onClose={onClose} size="3xl">
      <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4">
        <div className="space-y-2">
          {[
            ["new", "建立新帳號"],
            ["batch", "批次建立"],
            ["existing", "選擇既有使用者"],
          ].map(([key, label]) => (
            <button key={key} onClick={() => setMode(key as "new" | "batch" | "existing")} className="w-full text-left px-3 py-2 rounded-lg text-sm cursor-pointer" style={mode === key ? { background: "var(--primary-dim)", color: "var(--primary)" } : { color: "var(--text-muted)", border: "1px solid var(--border)" }}>{label}</button>
          ))}
          <div className="rounded-xl p-3" style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
            <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>權限預覽</p>
            <p className="text-lg font-semibold mt-1" style={{ color: "var(--text-primary)" }}>{previewCodes.length}</p>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>含 {previewCodes.filter(highRisk).length} 個高風險權限</p>
          </div>
        </div>
        <div className="space-y-4">
          {mode === "existing" ? (
            <SelectInput value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">選擇使用者</option>{users.map((u) => <option key={u.id} value={u.id}>{u.display_name} · {u.email}</option>)}</SelectInput>
          ) : mode === "new" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名" />
              <TextInput value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="學號（擇一）" />
              <TextInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email（擇一）" className="sm:col-span-2" />
              <TextInput
                value={linkedEmails}
                onChange={(e) => setLinkedEmails(e.target.value)}
                placeholder="其他登入 Email（選填，可用逗號分隔）"
                className="sm:col-span-2"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={batchInput}
                onChange={(event) => {
                  setBatchInput(event.target.value);
                  setBatchResult(null);
                }}
                rows={8}
                placeholder={"112040101,王小明\ng0112040102@hchs.hc.edu.tw;private@gmail.com,李小華"}
                className="w-full text-sm px-3 py-2 rounded-lg outline-none font-mono"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
              />
              <div className="flex justify-between text-xs" style={{ color: "var(--text-muted)" }}>
                <span>每列：學號或 Email[;其他 Email],姓名，也可貼上試算表兩欄</span>
                <span>{batchUsers.length} / 200 筆</span>
              </div>
              {batchResult && batchResult.failed > 0 && (
                <div className="max-h-32 overflow-y-auto rounded-lg p-2 text-xs space-y-1" style={{ border: "1px solid rgba(245,158,11,0.3)" }}>
                  {batchResult.results.filter((result) => !result.success).map((result) => (
                    <p key={result.index} style={{ color: "#f59e0b" }}>
                      第 {result.index + 1} 列 {result.display_name}：{result.error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_150px] gap-3">
            <SelectInput value={positionId} onChange={(e) => setPositionId(e.target.value)}><option value="">選擇職位（套用職位權限）</option>{uniquePositions.map((p) => <option key={p.id} value={p.id}>{POSITION_CATEGORY_LABEL[p.category]} · {p.org_name} · {p.name}</option>)}</SelectInput>
            <TextInput type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ colorScheme: "dark" }} />
            <TextInput type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={{ colorScheme: "dark" }} />
          </div>
          {mode === "new" && (
            <div className="space-y-2">
              <SelectInput value={customOrgId} onChange={(e) => setCustomOrgId(e.target.value)}><option value="">不疊加個人自訂權限</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</SelectInput>
              {customOrgId && <PermCheckboxes selected={customCodes} onChange={setCustomCodes} permCodes={permCodes} />}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {previewCodes.map((code) => {
              const info = permCodes.find((p) => p.code === code);
              return <span key={code} className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: highRisk(code) ? "#f59e0b" : "var(--primary)", border: "1px solid var(--border-strong)" }}>{info?.label ?? code}</span>;
            })}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <SmallButton onClick={onClose}>取消</SmallButton>
        <SmallButton onClick={submit} tone="primary" disabled={submitting}>
          {submitting ? "處理中..." : mode === "batch" ? `建立 ${batchUsers.length} 筆` : "確認上任"}
        </SmallButton>
      </div>
    </Modal>
  );
}
