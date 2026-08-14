"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  KeyRound,
  LogOut,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  ScrollText,
  Ticket,
  UserRound,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import AdminWorkbenchTabs from "@/components/admin/AdminWorkbenchTabs";
import { usePermissions } from "@/hooks/usePermissions";
import { apiErrorMessage, supportApi } from "@/lib/api";
import { saveImpersonationSession } from "@/lib/auth-cache";
import type {
  SupportApproval,
  SupportAuditEntry,
  SupportDashboard,
  SupportGuide,
  SupportTicket,
  SupportUserDetail,
  SupportUserSummary,
} from "@/lib/types";

type Tab = "overview" | "users" | "tickets" | "approvals" | "audit" | "guides";

const tabs: Array<{ id: Tab; label: string; icon: typeof Ticket }> = [
  { id: "overview", label: "總覽", icon: ShieldCheck },
  { id: "users", label: "使用者", icon: UserRound },
  { id: "tickets", label: "工單", icon: Ticket },
  { id: "approvals", label: "核准中心", icon: ClipboardCheck },
  { id: "audit", label: "操作紀錄", icon: ScrollText },
  { id: "guides", label: "知識庫", icon: BookOpen },
];

function Button({
  children,
  onClick,
  disabled,
  tone = "neutral",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "neutral" | "primary" | "warning" | "danger";
}) {
  const styles = {
    neutral: { color: "var(--text-secondary)", border: "1px solid var(--border)" },
    primary: { color: "var(--primary-fg)", background: "var(--primary)", border: "1px solid var(--primary)" },
    warning: { color: "var(--warning)", border: "1px solid var(--warning-border)" },
    danger: { color: "var(--danger)", border: "1px solid var(--danger-border)" },
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      style={styles}
    >
      {children}
    </button>
  );
}

function Field({
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const common = {
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    placeholder,
    className: "w-full rounded-lg px-3 py-2.5 text-sm outline-none placeholder:text-[var(--text-muted)]",
    style: { background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)" },
  };
  return multiline ? <textarea {...common} rows={4} /> : <input {...common} />;
}

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "warning" | "danger" }) {
  const colors = {
    neutral: { color: "var(--text-secondary)", background: "var(--bg-elevated)" },
    success: { color: "var(--success)", background: "var(--success-dim)" },
    warning: { color: "var(--warning)", background: "var(--warning-dim)" },
    danger: { color: "var(--danger)", background: "var(--danger-dim)" },
  }[tone];
  return <span className="rounded-full px-2 py-1 text-[11px] font-medium" style={colors}>{children}</span>;
}

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl p-4 sm:p-5" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function SupportConsolePage() {
  const { canAny, isAdmin } = usePermissions();
  const allowed = isAdmin || canAny("support.users.read", "support.tickets.read");
  const canInteractiveImpersonate = isAdmin || canAny("support.users.impersonate_interactive");
  const [tab, setTab] = useState<Tab>("overview");
  const [dashboard, setDashboard] = useState<SupportDashboard | null>(null);
  const [users, setUsers] = useState<SupportUserSummary[]>([]);
  const [selectedUser, setSelectedUser] = useState<SupportUserDetail | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [approvals, setApprovals] = useState<SupportApproval[]>([]);
  const [audit, setAudit] = useState<SupportAuditEntry[]>([]);
  const [guides, setGuides] = useState<SupportGuide[]>([]);
  const [keyword, setKeyword] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [newTicketTitle, setNewTicketTitle] = useState("");
  const [newTicketDescription, setNewTicketDescription] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      setDashboard(await supportApi.dashboard());
    } catch (error) {
      toast.error(apiErrorMessage(error, "載入客服總覽失敗"));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      setUsers(await supportApi.searchUsers(keyword));
    } catch (error) {
      toast.error(apiErrorMessage(error, "搜尋使用者失敗"));
    }
  }, [keyword]);

  const loadUser = async (id: string) => {
    try {
      setSelectedUser(await supportApi.getUser(id, true));
      setTab("users");
    } catch (error) {
      toast.error(apiErrorMessage(error, "載入使用者詳情失敗"));
    }
  };

  const loadTickets = useCallback(async () => {
    try { setTickets(await supportApi.listTickets()); }
    catch (error) { toast.error(apiErrorMessage(error, "載入工單失敗")); }
  }, []);

  const loadApprovals = useCallback(async () => {
    try { setApprovals(await supportApi.listApprovals()); }
    catch (error) { toast.error(apiErrorMessage(error, "載入核准申請失敗")); }
  }, []);

  const loadAudit = useCallback(async () => {
    try { setAudit(await supportApi.listAudit()); }
    catch (error) { toast.error(apiErrorMessage(error, "載入客服稽核失敗")); }
  }, []);

  const loadGuides = useCallback(async () => {
    try { setGuides(await supportApi.listGuides()); }
    catch (error) { toast.error(apiErrorMessage(error, "載入知識庫失敗")); }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void loadDashboard();
    void loadUsers();
    void loadTickets();
    void loadApprovals();
    void loadAudit();
    void loadGuides();
  }, [allowed, loadAudit, loadApprovals, loadDashboard, loadGuides, loadTickets, loadUsers]);

  const createTicket = async () => {
    if (!newTicketTitle.trim() || !newTicketDescription.trim()) {
      toast.error("請填寫工單標題與問題描述");
      return;
    }
    try {
      const ticket = await supportApi.createTicket({
        title: newTicketTitle,
        description: newTicketDescription,
        user_id: selectedUser?.user.id ?? null,
        priority: "normal",
        channel: "internal",
      });
      setTicketId(ticket.id);
      setNewTicketTitle("");
      setNewTicketDescription("");
      toast.success(`已建立 ${ticket.ticket_number}`);
      await Promise.all([loadTickets(), loadDashboard()]);
    } catch (error) { toast.error(apiErrorMessage(error, "建立工單失敗")); }
  };

  const runAction = async (action: string) => {
    if (!selectedUser || !ticketId || reason.trim().length < 10) {
      toast.error("請先選擇使用者、工單，並填寫至少 10 字的操作原因");
      return;
    }
    if (!window.confirm(`確定執行「${action}」？這次操作會寫入客服稽核。`)) return;
    try {
      await supportApi.repair(selectedUser.user.id, action, { ticket_id: ticketId, reason });
      toast.success("受控修復已完成");
      setSelectedUser(await supportApi.getUser(selectedUser.user.id, true));
      await Promise.all([loadAudit(), loadDashboard()]);
    } catch (error) { toast.error(apiErrorMessage(error, "修復操作失敗")); }
  };

  const revealSensitive = async () => {
    if (!selectedUser || !ticketId || reason.trim().length < 10) {
      toast.error("敏感資料查看需要工單與操作原因");
      return;
    }
    try {
      const result = await supportApi.revealSensitive(selectedUser.user.id, { ticket_id: ticketId, reason });
      toast.success(`已取得受控資料：${result.email}`);
      await loadAudit();
    } catch (error) { toast.error(apiErrorMessage(error, "查看敏感資料失敗")); }
  };

  const diagnose = async () => {
    if (!selectedUser || !ticketId || reason.trim().length < 10) {
      toast.error("診斷需要工單與操作原因");
      return;
    }
    try {
      const diagnostics = await supportApi.diagnose(selectedUser.user.id, { ticket_id: ticketId, reason });
      setSelectedUser({ ...selectedUser, diagnostics });
      toast.success("診斷完成");
      await Promise.all([loadAudit(), loadDashboard()]);
    } catch (error) { toast.error(apiErrorMessage(error, "診斷失敗")); }
  };

  const startImpersonation = async (mode: "read_only" | "interactive") => {
    if (!selectedUser || !ticketId || reason.trim().length < 10) {
      toast.error("模擬使用者需要工單與操作原因");
      return;
    }
    try {
      const session = await supportApi.startImpersonation({
        target_user_id: selectedUser.user.id,
        ticket_id: ticketId,
        reason,
        mode,
        minutes: 15,
      });
      saveImpersonationSession({
        token: session.token,
        target_user_id: session.target_user_id,
        target_email: session.target_email,
        target_display_name: session.target_display_name,
        actor_email: session.actor_email,
        actor_display_name: session.actor_display_name,
        expires_at: new Date(session.expires_at).getTime(),
        read_only: session.read_only,
      });
      window.location.assign("/dashboard");
    } catch (error) { toast.error(apiErrorMessage(error, "啟動模擬使用者失敗")); }
  };

  const reviewApproval = async (approval: SupportApproval, approved: boolean) => {
    const note = window.prompt(approved ? "請輸入核准理由" : "請輸入拒絕理由", reason || "已完成差異檢查") ?? "";
    if (note.trim().length < 10) return toast.error("理由至少需要 10 字");
    try {
      await supportApi.reviewApproval(approval.id, { approved, note });
      toast.success(approved ? "核准並執行完成" : "已拒絕申請");
      await Promise.all([loadApprovals(), loadAudit(), loadDashboard()]);
    } catch (error) { toast.error(apiErrorMessage(error, "處理核准申請失敗")); }
  };

  const actionButtons = useMemo(() => [
    { action: "unlock", label: "解除鎖定", icon: KeyRound, tone: "neutral" as const },
    { action: "revoke_sessions", label: "撤銷 Session", icon: LogOut, tone: "warning" as const },
    { action: "reset_mfa", label: "重設 MFA", icon: ShieldCheck, tone: "warning" as const },
    { action: "refresh_permissions", label: "刷新權限", icon: RefreshCw, tone: "neutral" as const },
    { action: "rebuild_profile", label: "重建個人設定", icon: Wrench, tone: "neutral" as const },
    { action: "rebuild_navigation", label: "重建導覽設定", icon: RefreshCw, tone: "neutral" as const },
    { action: "resend_verification", label: "重寄驗證信", icon: Mail, tone: "neutral" as const },
  ], []);
  const metricCards: Array<[string, number, string]> = dashboard ? [
    ["待處理工單", dashboard.open_tickets, "var(--primary)"],
    ["緊急工單", dashboard.urgent_tickets, "var(--danger)"],
    ["待核准", dashboard.pending_approvals, "var(--warning)"],
    ["協助模式", dashboard.active_assistance_sessions, "var(--success)"],
    ["模擬工作階段", dashboard.active_impersonation_sessions, "var(--primary)"],
  ] : [];

  if (!allowed) {
    return <div className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>您沒有客服作業平台權限。</div>;
  }

  return (
    <div className="min-h-[calc(100vh-4rem)]" style={{ background: "var(--bg-page)" }}>
      <AdminWorkbenchTabs />
      <header className="border-b px-4 py-5 sm:px-6" style={{ borderColor: "var(--border)" }}>
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em]" style={{ color: "var(--primary-text)" }}>SUPPORT CONSOLE</p>
            <h1 className="mt-1 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>客服作業平台</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6" style={{ color: "var(--text-muted)" }}>
              協助使用者完成問題排查與修復；每一次資料查看、代理與修改都綁定工單並留下稽核。
            </p>
          </div>
          <Button onClick={() => void Promise.all([loadDashboard(), loadUsers(), loadTickets(), loadApprovals(), loadAudit(), loadGuides()])} disabled={loading}>
            <RefreshCw size={16} />重新整理
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">
        <div className="mb-5 flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--border)" }}>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setTab(id)} className="inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium" style={{ color: tab === id ? "var(--primary)" : "var(--text-muted)", borderColor: tab === id ? "var(--primary)" : "transparent" }}>
              <Icon size={15} />{label}
            </button>
          ))}
        </div>

        {tab === "overview" && dashboard && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {metricCards.map(([label, value, color]) => (
                <div key={String(label)} className="rounded-xl p-4" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</p>
                  <p className="mt-2 text-2xl font-semibold" style={{ color }}>{value}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <Panel title="最近客服操作">
                <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {dashboard.recent_actions.length === 0 ? <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚無客服操作。</p> : dashboard.recent_actions.map((action, index) => (
                    <div key={String(action.id ?? index)} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0"><p className="truncate text-sm" style={{ color: "var(--text-primary)" }}>{String(action.action)}</p><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{String(action.created_at)}</p></div>
                      <Pill tone={action.risk_level === "high" ? "danger" : action.risk_level === "medium" ? "warning" : "neutral"}>{String(action.risk_level)}</Pill>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel title="操作原則">
                <div className="space-y-3 text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
                  <p><CheckCircle2 className="mr-2 inline text-[var(--success)]" size={16} />固定 action 與欄位白名單</p>
                  <p><CheckCircle2 className="mr-2 inline text-[var(--success)]" size={16} />超管可直接查看完整資料，其他客服維持遮罩</p>
                  <p><CheckCircle2 className="mr-2 inline text-[var(--success)]" size={16} />中、高風險操作需要再次確認或雙人核准</p>
                  <p><CheckCircle2 className="mr-2 inline text-[var(--success)]" size={16} />唯讀模擬工作階段由後端強制阻擋寫入</p>
                </div>
              </Panel>
            </div>
          </div>
        )}

        {tab === "users" && (
          <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
            <Panel title="使用者搜尋">
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1"><Search size={16} className="absolute left-3 top-3" style={{ color: "var(--text-muted)" }} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadUsers(); }} placeholder="姓名、Email、學號、UUID、工單或錯誤編號" className="min-h-10 w-full rounded-lg pl-9 pr-3 text-sm outline-none" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }} /></div>
                <Button onClick={() => void loadUsers()}><Search size={15} /></Button>
              </div>
              <div className="mt-4 divide-y" style={{ borderColor: "var(--border)" }}>
                {users.map((user) => <button key={user.id} type="button" onClick={() => void loadUser(user.id)} className="flex min-h-16 w-full items-center gap-3 py-3 text-left hover:bg-[var(--bg-hover)]"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>{user.display_name[0]}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{user.display_name}</span><span className="block truncate text-xs" style={{ color: "var(--text-muted)" }}>{user.email}</span></span><Pill tone={user.is_active ? "success" : "danger"}>{user.is_active ? "正常" : "停用"}</Pill></button>)}
                {users.length === 0 && <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>輸入關鍵字開始搜尋。</p>}
              </div>
            </Panel>

            <div className="space-y-5">
              {!selectedUser ? <Panel title="尚未選擇使用者"><p className="text-sm" style={{ color: "var(--text-muted)" }}>從左側搜尋結果選擇使用者，系統會顯示目前權限可見的資料與可用診斷。</p></Panel> : <>
                <Panel title="使用者資料" action={<div className="flex gap-2"><Pill tone={selectedUser.user.is_active ? "success" : "danger"}>{selectedUser.user.is_active ? "帳號正常" : "帳號停用"}</Pill>{selectedUser.user.mfa_enabled && <Pill tone="success">MFA 已啟用</Pill>}</div>}>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><div><p className="text-xs" style={{ color: "var(--text-muted)" }}>姓名</p><p className="mt-1 text-sm" style={{ color: "var(--text-primary)" }}>{selectedUser.user.display_name}</p></div><div><p className="text-xs" style={{ color: "var(--text-muted)" }}>Email</p><p className="mt-1 text-sm" style={{ color: "var(--text-primary)" }}>{selectedUser.user.email}</p></div><div><p className="text-xs" style={{ color: "var(--text-muted)" }}>學號</p><p className="mt-1 text-sm" style={{ color: "var(--text-primary)" }}>{selectedUser.user.student_id ?? "未設定"}</p></div><div><p className="text-xs" style={{ color: "var(--text-muted)" }}>Email 驗證</p><p className="mt-1 text-sm" style={{ color: selectedUser.user.is_verified ? "var(--success)" : "var(--warning)" }}>{selectedUser.user.is_verified ? "已完成" : "尚未完成"}</p></div></div>
                  <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{actionButtons.map(({ action, label, icon: Icon, tone }) => <Button key={action} onClick={() => void runAction(action)} tone={tone}><Icon size={15} />{label}</Button>)}</div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Button onClick={diagnose}><ShieldCheck size={15} />執行診斷</Button>{!isAdmin && <Button onClick={revealSensitive} tone="warning"><Eye size={15} />受控查看個資</Button>}<Button onClick={() => void startImpersonation("read_only")}><Eye size={15} />唯讀模擬</Button>{canInteractiveImpersonate && <Button onClick={() => void startImpersonation("interactive")} tone="warning"><UserRound size={15} />可操作模擬</Button>}</div>
                </Panel>
                <div className="grid gap-5 lg:grid-cols-2"><Panel title="處理上下文"><div className="space-y-3"><label className="block text-xs" style={{ color: "var(--text-muted)" }}>綁定工單 ID</label><Field value={ticketId} onChange={setTicketId} placeholder="先建立或貼上工單 UUID" /><label className="block text-xs" style={{ color: "var(--text-muted)" }}>操作原因（所有操作共用）</label><Field value={reason} onChange={setReason} placeholder="例如：使用者無法看到財務選單，已完成身分確認" multiline /></div></Panel><Panel title="診斷結果"><div className="space-y-2">{selectedUser.diagnostics.length === 0 ? <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚未執行診斷。</p> : selectedUser.diagnostics.map((item) => <div key={item.code} className="flex gap-3 rounded-lg p-3" style={{ background: "var(--bg-elevated)" }}><AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: item.severity === "error" ? "var(--danger)" : item.severity === "warning" ? "var(--warning)" : "var(--success)" }} /><div><p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{item.code}</p><p className="mt-1 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>{item.message}</p></div></div>)}</div></Panel></div>
                <Panel title="建立工單"><div className="grid gap-3 lg:grid-cols-[0.8fr_1.2fr_auto]"><Field value={newTicketTitle} onChange={setNewTicketTitle} placeholder="工單標題" /><Field value={newTicketDescription} onChange={setNewTicketDescription} placeholder="問題描述" multiline /><Button onClick={() => void createTicket()} tone="primary"><Ticket size={15} />建立</Button></div></Panel>
                <Panel title="角色與權限"><div className="space-y-3">{selectedUser.roles.map((role) => <div key={role.id} className="rounded-lg p-3" style={{ background: "var(--bg-elevated)" }}><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{role.org_name} · {role.name}</p><span className="text-xs" style={{ color: "var(--text-muted)" }}>{role.start_date} → {role.end_date ?? "目前"}</span></div><div className="mt-2 flex flex-wrap gap-1.5">{role.permission_codes.map((code) => <Pill key={code}>{code}</Pill>)}</div></div>)}{selectedUser.roles.length === 0 && <p className="text-sm" style={{ color: "var(--text-muted)" }}>沒有有效職位。</p>}</div></Panel>
              </>}
            </div>
          </div>
        )}

        {tab === "tickets" && <Panel title="客服工單" action={<Button onClick={() => void loadTickets()}><RefreshCw size={15} />重新整理</Button>}><div className="space-y-2">{tickets.map((ticket) => <button key={ticket.id} type="button" onClick={() => { setTicketId(ticket.id); if (ticket.user_id) void loadUser(ticket.user_id); }} className="flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-[var(--bg-hover)]" style={{ border: "1px solid var(--border)" }}><Ticket size={17} style={{ color: "var(--primary)" }} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{ticket.ticket_number} · {ticket.title}</span><Pill tone={ticket.priority === "urgent" ? "danger" : ticket.status === "resolved" || ticket.status === "closed" ? "success" : "neutral"}>{ticket.status}</Pill></div><p className="mt-1 truncate text-xs" style={{ color: "var(--text-muted)" }}>{ticket.description}</p></div><span className="text-xs" style={{ color: "var(--text-muted)" }}>{ticket.updated_at}</span></button>)}{tickets.length === 0 && <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>尚無工單。</p>}</div></Panel>}

        {tab === "approvals" && <Panel title="高風險核准中心" action={<Button onClick={() => void loadApprovals()}><RefreshCw size={15} />重新整理</Button>}><div className="space-y-3">{approvals.map((approval) => <div key={approval.id} className="rounded-lg p-4" style={{ border: "1px solid var(--border)" }}><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{approval.approval_number} · {approval.action}</p><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{approval.reason}</p></div><Pill tone={approval.status === "pending" ? "warning" : approval.status === "executed" ? "success" : "danger"}>{approval.status}</Pill></div><pre className="mt-3 overflow-auto rounded-lg p-3 text-xs" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>{JSON.stringify(approval.payload, null, 2)}</pre>{approval.status === "pending" && approval.requested_by !== (typeof window !== "undefined" ? localStorage.getItem("user_id") : "") && <div className="mt-3 flex gap-2"><Button onClick={() => void reviewApproval(approval, true)} tone="primary"><CheckCircle2 size={15} />核准並執行</Button><Button onClick={() => void reviewApproval(approval, false)} tone="danger">拒絕</Button></div>}</div>)}{approvals.length === 0 && <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>目前沒有核准申請。</p>}</div></Panel>}

        {tab === "audit" && <Panel title="客服 append-only 稽核" action={<Button onClick={() => void loadAudit()}><RefreshCw size={15} />重新整理</Button>}><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}><th className="px-3 py-2">時間</th><th className="px-3 py-2">操作</th><th className="px-3 py-2">風險</th><th className="px-3 py-2">目標使用者</th><th className="px-3 py-2">原因</th><th className="px-3 py-2">IP</th></tr></thead><tbody>{audit.map((row) => <tr key={row.id} className="border-b" style={{ borderColor: "var(--border)" }}><td className="px-3 py-3 text-xs" style={{ color: "var(--text-muted)" }}>{row.created_at}</td><td className="px-3 py-3 font-medium" style={{ color: "var(--text-primary)" }}>{row.action}</td><td className="px-3 py-3"><Pill tone={row.risk_level === "high" ? "danger" : row.risk_level === "medium" ? "warning" : "neutral"}>{row.risk_level}</Pill></td><td className="px-3 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{row.target_user_id ?? "—"}</td><td className="max-w-[24rem] px-3 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>{row.reason}</td><td className="px-3 py-3 text-xs" style={{ color: "var(--text-muted)" }}>{row.ip_address ?? "—"}</td></tr>)}</tbody></table>{audit.length === 0 && <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>尚無客服稽核。</p>}</div></Panel>}

        {tab === "guides" && <Panel title="客服操作知識庫" action={<Button onClick={() => void loadGuides()}><RefreshCw size={15} />重新整理</Button>}><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{guides.map((guide) => <article key={guide.id} className="rounded-lg p-4" style={{ border: "1px solid var(--border)" }}><div className="flex items-center justify-between gap-2"><Pill>{guide.category}</Pill>{guide.route && <span className="text-xs" style={{ color: "var(--primary-text)" }}>{guide.route}</span>}</div><h3 className="mt-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{guide.title}</h3><p className="mt-2 text-xs leading-5" style={{ color: "var(--text-secondary)" }}>{guide.summary}</p><details className="mt-3"><summary className="cursor-pointer text-xs font-medium" style={{ color: "var(--primary)" }}>查看操作步驟</summary><p className="mt-2 whitespace-pre-wrap text-xs leading-5" style={{ color: "var(--text-secondary)" }}>{guide.body}</p></details></article>)}{guides.length === 0 && <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>尚未建立客服知識庫內容。</p>}</div></Panel>}
      </main>
    </div>
  );
}
