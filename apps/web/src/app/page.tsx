"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  documentsApi,
  notificationsApi,
  regulationsApi,
  type DocumentStats,
  type NotificationItem,
} from "@/lib/api";
import type { DocumentListItem, RegulationListItem } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";
import { DocumentStatusBadge } from "@/components/ui/StatusBadge";

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const STAT_CARDS = [
  {
    key: "draft" as const,
    label: "草稿中",
    href: "/documents?status=draft",
    color: "var(--text-muted)",
    bg: "var(--bg-hover)",
    border: "var(--border)",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
      </svg>
    ),
  },
  {
    key: "pending_submitted" as const,
    label: "我已送審",
    href: "/documents?status=pending",
    color: "var(--warning)",
    bg: "var(--warning-dim)",
    border: "var(--warning-border)",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    key: "pending_my_approval" as const,
    label: "待我審核",
    href: "/documents?status=pending&my_approval=true",
    color: "var(--primary)",
    bg: "var(--primary-dim)",
    border: "var(--info-border)",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    key: "approved_this_month" as const,
    label: "本月核准",
    href: "/documents?status=approved",
    color: "var(--success)",
    bg: "var(--success-dim)",
    border: "var(--success-border)",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
];

const QUICK_LINK_ICONS: Record<string, React.ReactNode> = {
  "/documents/new": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="13" x2="12" y2="17"/><line x1="10" y1="15" x2="14" y2="15"/></svg>
  ),
  "/documents": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
  ),
  "/regulations": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
  ),
  "/regulations/new": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
  ),
  "/shop": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
  ),
  "/meal": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
  ),
  "/surveys": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
  ),
  "/serial-templates": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
  ),
  "/public": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
  ),
  "/audit-logs": (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
  ),
};

export default function DashboardPage() {
  const [userName, setUserName] = useState("");
  const [greeting, setGreeting] = useState("歡迎回來");
  const [stats, setStats] = useState<DocumentStats | null>(null);
  const [recentDocs, setRecentDocs] = useState<DocumentListItem[]>([]);
  const [pendingRegs, setPendingRegs] = useState<RegulationListItem[]>([]);
  const [frozenRegs, setFrozenRegs] = useState<RegulationListItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const { can } = usePermissions();

  useEffect(() => {
    const name = localStorage.getItem("user_name");
    if (name) setUserName(name);
    const h = new Date().getHours();
    if (h < 12) setGreeting("早安");
    else if (h < 18) setGreeting("午安");
    else setGreeting("晚安");
  }, []);

  useEffect(() => {
    const userId = localStorage.getItem("user_id");
    if (!userId) { setLoading(false); return; }
    // Fetch independently so stats don't block recent docs rendering
    documentsApi.stats().then(s => { if (s) setStats(s); }).catch(() => null);
    documentsApi.list({ my_only: "true", limit: "6" })
      .then(docs => setRecentDocs(docs as DocumentListItem[]))
      .catch(() => [])
      .finally(() => setLoading(false));
    regulationsApi.list({ active_only: "false" })
      .then(regs => {
        setPendingRegs(
          regs.filter(r => ["under_review", "scheduled", "council_approved"].includes(r.workflow_status))
              .slice(0, 5)
        );
        setFrozenRegs(regs.filter(r => r.freeze_reason).slice(0, 3));
      })
      .catch(() => []);
    notificationsApi.count()
      .then(({ unread }) => setUnreadCount(unread))
      .catch(() => null);
    notificationsApi.list(false, 5)
      .then(setNotifications)
      .catch(() => []);
  }, []);

  const markAllNotificationsRead = async () => {
    try {
      await notificationsApi.markAllRead();
      setUnreadCount(0);
      setNotifications((items) => items.map((item) => ({ ...item, is_read: true })));
    } catch {
      // Dashboard should stay useful even if notification state fails to sync.
    }
  };

  const quickLinks = [
    ...(can("document:create") ? [{ href: "/documents/new", label: "新增公文", desc: "建立並提交新公文" }] : []),
    { href: "/documents", label: "公文列表", desc: "查看所有公文紀錄" },
    { href: "/regulations", label: "法規查詢", desc: "瀏覽最新法規條文" },
    ...(can("regulation:create") ? [{ href: "/regulations/new", label: "新增法規", desc: "起草新法規草稿" }] : []),
    { href: "/public", label: "公開資訊入口", desc: "法規資料庫、公開公文" },
    { href: "/shop", label: "訂購系統", desc: "商品訂購管理" },
    { href: "/meal", label: "學餐訂購", desc: "訂今日午餐" },
    { href: "/surveys", label: "問卷填答", desc: "填答問卷表達意見" },
    ...(can("doc.issue") ? [{ href: "/serial-templates", label: "字號模板", desc: "設定公文字號規則" }] : []),
    ...(can("admin:all") || can("audit:view_org") || can("audit:view_all")
      ? [{ href: "/audit-logs", label: "稽核日誌", desc: "查看所有操作軌跡" }]
      : []),
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* ── 頁首 ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            {greeting}，{userName || "使用者"}
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            這是您今日的公文概覽
          </p>
        </div>
        {can("document:create") && (
          <Link href="/documents/new" className="btn btn-primary self-start sm:self-auto">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            新增公文
          </Link>
        )}
      </div>

      {/* ── 統計卡片 ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" role="list" aria-label="公文統計">
        {STAT_CARDS.filter(s => s.key !== "pending_my_approval" || can("document:approve")).map((s) => (
          <Link
            key={s.key}
            href={s.href}
            role="listitem"
            className="card card-hover block p-5"
            style={{ textDecoration: "none" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                {s.label}
              </p>
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
                aria-hidden="true">
                {s.icon}
              </div>
            </div>
            {loading ? (
              <div className="h-9 w-14 rounded-lg animate-pulse" style={{ background: "var(--bg-hover)" }} />
            ) : (
              <p className="text-3xl font-bold leading-none" style={{ color: s.color }}>
                {s.key === "draft" ? (stats?.draft ?? 0)
                  : s.key === "pending_submitted" ? (stats?.pending_submitted ?? 0)
                  : s.key === "pending_my_approval" ? (stats?.pending_my_approval ?? 0)
                  : (stats?.approved_this_month ?? 0)}
              </p>
            )}
          </Link>
        ))}
      </div>

      {/* ── 主要內容 ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* 近期公文 */}
        <section className="lg:col-span-2 overflow-hidden" aria-labelledby="recent-docs-heading"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-sm)",
          }}>
          <div className="px-5 py-4 flex items-center justify-between"
            style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 id="recent-docs-heading" className="text-sm font-semibold"
              style={{ color: "var(--text-primary)" }}>
              近期公文
            </h2>
            <Link href="/documents" className="text-xs font-medium"
              style={{ color: "var(--primary)", textDecoration: "none" }}>
              查看全部 →
            </Link>
          </div>

          {loading ? (
            <div className="px-5 py-10 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--primary)" }} />
            </div>
          ) : recentDocs.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              尚無公文紀錄
            </div>
          ) : (
            <ul>
              {recentDocs.map((doc, idx) => (
                <li key={doc.id} style={idx < recentDocs.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                  <Link
                    href={`/documents/${encodeURIComponent(doc.serial_number)}`}
                    className="flex items-center gap-3 px-5 py-3.5 transition-colors"
                    style={{ textDecoration: "none" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <span className="text-xs font-mono w-28 flex-shrink-0 truncate hidden sm:block"
                      style={{ color: "var(--primary)" }}>
                      {doc.serial_number}
                    </span>
                    <span className="flex-1 text-sm truncate" style={{ color: "var(--text-primary)" }}>
                      {doc.title}
                    </span>
                    <DocumentStatusBadge status={doc.status} />
                    <span className="text-xs w-10 text-right flex-shrink-0 hidden sm:block"
                      style={{ color: "var(--text-muted)" }}>
                      {formatDate(doc.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          <section aria-labelledby="dashboard-notifications-heading">
            <div
              className="overflow-hidden"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                boxShadow: "var(--shadow-sm)",
              }}>
              <div className="px-5 py-4 flex items-center justify-between gap-3"
                style={{ borderBottom: "1px solid var(--border)" }}>
                <div>
                  <h2 id="dashboard-notifications-heading" className="text-sm font-semibold"
                    style={{ color: "var(--text-primary)" }}>
                    通知中心
                  </h2>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {unreadCount > 0 ? `${unreadCount} 則未讀` : "沒有未讀通知"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={markAllNotificationsRead}
                  disabled={unreadCount === 0}
                  className="text-xs font-medium disabled:opacity-40"
                  style={{ color: "var(--primary)" }}>
                  全數已讀
                </button>
              </div>
              {notifications.length === 0 ? (
                <p className="px-5 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                  目前沒有通知
                </p>
              ) : (
                <ul>
                  {notifications.map((item, idx) => (
                    <li key={item.id}
                      style={idx < notifications.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                      <Link
                        href={item.link ?? "/"}
                        className="flex items-start gap-3 px-5 py-3 transition-colors"
                        style={{ textDecoration: "none" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                        {!item.is_read && (
                          <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                            style={{ background: "var(--primary)" }} aria-hidden="true" />
                        )}
                        <div className={`min-w-0 flex-1 ${item.is_read ? "pl-5" : ""}`}>
                          <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                            {item.title}
                          </p>
                          {item.body && (
                            <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
                              {item.body}
                            </p>
                          )}
                          <p className="text-[10px] mt-1" style={{ color: "var(--text-disabled)" }}>
                            {new Date(item.created_at).toLocaleDateString("zh-TW")}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* 快速操作 */}
          <section aria-labelledby="quick-links-heading">
          <div
            className="overflow-hidden"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-sm)",
            }}>
            <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
              <h2 id="quick-links-heading" className="text-sm font-semibold"
                style={{ color: "var(--text-primary)" }}>
                快速操作
              </h2>
            </div>
            <ul className="p-2">
              {quickLinks.map((ql) => (
                <li key={ql.href}>
                  <Link
                    href={ql.href}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer"
                    style={{ textDecoration: "none" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <div
                      className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                      style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                      {QUICK_LINK_ICONS[ql.href] ?? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                        {ql.label}
                      </p>
                      <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                        {ql.desc}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          </section>
        </aside>
      </div>

      {/* ── 法規流程提醒 ───────────────────────────────────────────────────── */}
      {pendingRegs.length > 0 && (
        <section aria-labelledby="reg-pipeline-heading">
          <div className="card overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between"
              style={{ borderBottom: "1px solid var(--border)" }}>
              <h2 id="reg-pipeline-heading" className="text-sm font-semibold flex items-center gap-2"
                style={{ color: "var(--text-primary)" }}>
                <span className="w-2 h-2 rounded-full animate-pulse inline-block"
                  style={{ background: "var(--warning)" }} aria-hidden="true" />
                法規審議中
              </h2>
              <Link href="/regulations" className="text-xs font-medium"
                style={{ color: "var(--primary)", textDecoration: "none" }}>
                查看全部 →
              </Link>
            </div>
            <ul>
              {pendingRegs.map((reg, idx) => {
                const WF_INFO: Record<string, { label: string; color: string }> = {
                  under_review:     { label: "送審中",   color: "#0284c7" },
                  scheduled:        { label: "排入議程", color: "#7c3aed" },
                  council_approved: { label: "待主席公布", color: "var(--warning)" },
                };
                const info = WF_INFO[reg.workflow_status] ?? { label: reg.workflow_status, color: "var(--text-muted)" };
                return (
                  <li key={reg.id}
                    style={idx < pendingRegs.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                    <Link
                      href={`/regulations/${reg.id}`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors"
                      style={{ textDecoration: "none" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ color: info.color, background: `${info.color}18`, border: `1px solid ${info.color}30` }}>
                        {info.label}
                      </span>
                      <span className="flex-1 text-sm truncate" style={{ color: "var(--text-primary)" }}>
                        {reg.title}
                      </span>
                      <span className="text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                        v{reg.version}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* ── 凍結法規提醒 ───────────────────────────────────────────────────── */}
      {frozenRegs.length > 0 && (
        <section aria-labelledby="frozen-reg-heading">
          <div className="card overflow-hidden"
            style={{ border: "1px solid rgba(251,146,60,0.3)" }}>
            <div className="px-5 py-3.5 flex items-center justify-between"
              style={{ borderBottom: "1px solid rgba(251,146,60,0.2)", background: "rgba(251,146,60,0.05)" }}>
              <h2 id="frozen-reg-heading" className="text-sm font-semibold flex items-center gap-2"
                style={{ color: "#fb923c" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                已凍結法規（{frozenRegs.length}）
              </h2>
              <Link href="/regulations" className="text-xs font-medium"
                style={{ color: "#fb923c", textDecoration: "none" }}>
                查看全部 →
              </Link>
            </div>
            <ul>
              {frozenRegs.map((reg, idx) => (
                <li key={reg.id}
                  style={idx < frozenRegs.length - 1 ? { borderBottom: "1px solid rgba(251,146,60,0.15)" } : {}}>
                  <Link href={`/regulations/${reg.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors"
                    style={{ textDecoration: "none" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(251,146,60,0.05)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{ color: "#fb923c", background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.25)" }}>
                      凍結中
                    </span>
                    <span className="flex-1 text-sm truncate" style={{ color: "var(--text-primary)" }}>
                      {reg.title}
                    </span>
                    <span className="text-xs truncate max-w-[200px] flex-shrink-0 hidden sm:block"
                      style={{ color: "var(--text-muted)" }}>
                      {reg.freeze_reason}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

    </div>
  );
}
