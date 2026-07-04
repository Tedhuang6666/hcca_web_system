"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  FileText, ListChecks, Landmark, Scale, Megaphone, MessageSquare,
  CheckSquare, ChevronRight, Plus, Loader2, Sparkles, Clock, ArrowUpRight,
  Layers3, Zap, ShoppingCart, Utensils, CalendarDays, Inbox, ShieldCheck,
  Settings, Users, Bell, Search, PenLine, Send, Wrench, AlertCircle,
} from "lucide-react";
import {
  dashboardApi,
  governanceApi,
  tasksApi,
  type DashboardResponse,
  type DashboardWidget,
  type TaskInboxResponse,
  type TaskItem,
  type TaskModule,
} from "@/lib/api";
import type { MatterListItem } from "@/lib/types";
import { cacheGet, cacheHas, cacheSet } from "@/lib/api-cache";
import { usePermissions } from "@/hooks/usePermissions";
import { useRecentItems } from "@/hooks/useRecentItems";
import OnboardingHint from "@/components/ui/OnboardingHint";
import { resolveNavigationProfile, type NavigationProfile } from "@/lib/navigation";
import { riskColor, sortMattersByInsight } from "@/lib/governanceInsights";

type IconProps = { size: number; "aria-hidden": boolean };
function FallbackWidgetIcon(p: IconProps) { return <FileText {...p} />; }

const WIDGET_ICONS: Record<string, React.ComponentType<IconProps>> = {
  doc_draft: (p) => <FileText {...p} />,
  doc_pending_my_approval: (p) => <ListChecks {...p} />,
  meeting_upcoming: (p) => <Landmark {...p} />,
  regulation_review: (p) => <Scale {...p} />,
  regulation_publish: (p) => <Scale {...p} />,
  announcements_recent: (p) => <Megaphone {...p} />,
  petition_assigned: (p) => <MessageSquare {...p} />,
  open_surveys: (p) => <CheckSquare {...p} />,
  today_meal: (p) => <FileText {...p} />,
  class_order_collecting: (p) => <ListChecks {...p} />,
};

const SEVERITY_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  info: {
    color: "var(--primary)",
    bg: "var(--primary-dim)",
    border: "var(--info-border)",
  },
  warning: {
    color: "var(--warning)",
    bg: "var(--warning-dim)",
    border: "var(--warning-border)",
  },
  critical: {
    color: "var(--danger)",
    bg: "var(--danger-dim)",
    border: "var(--danger-border)",
  },
};

const HINT_LABEL: Record<string, string> = {
  student: "學生視角",
  teacher: "師長視角",
  vendor: "合作夥伴視角",
  mealVendor: "餐商視角",
  default: "完整平台視角",
  officer: "幹部視角",
  leader: "領導視角",
};

const MODULE_LABEL: Record<TaskModule, string> = {
  document: "公文",
  meeting: "議事",
  regulation: "法規",
  petition: "陳情",
  survey: "問卷",
  shop: "商品",
  meal: "學餐",
  announcement: "公告",
  calendar: "行事曆",
  work_item: "工作",
};

const TASK_ICONS: Record<TaskModule, React.ComponentType<IconProps>> = {
  document: (p) => <FileText {...p} />,
  meeting: (p) => <Landmark {...p} />,
  regulation: (p) => <Scale {...p} />,
  petition: (p) => <MessageSquare {...p} />,
  survey: (p) => <CheckSquare {...p} />,
  shop: (p) => <ShoppingCart {...p} />,
  meal: (p) => <Utensils {...p} />,
  announcement: (p) => <Megaphone {...p} />,
  calendar: (p) => <CalendarDays {...p} />,
  work_item: (p) => <ListChecks {...p} />,
};

function formatDate(s?: string | null) {
  if (!s) return "";
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatTaskDue(s?: string | null) {
  if (!s) return "無期限";
  const d = new Date(s);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((dueDay - start) / 86_400_000);
  if (diffDays < 0) return `已逾期 ${Math.abs(diffDays)} 天`;
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "明天";
  if (diffDays <= 7) return `${diffDays} 天內`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function WidgetCard({ w, index }: { w: DashboardWidget; index: number }) {
  const Icon = WIDGET_ICONS[w.key] ?? FallbackWidgetIcon;
  const sev = SEVERITY_STYLES[w.severity] ?? SEVERITY_STYLES.info;

  return (
    <section
      aria-labelledby={`widget-${w.key}`}
      className="dashboard-widget card overflow-hidden flex flex-col"
      style={{
        animationDelay: `${Math.min(index * 55, 330)}ms`,
      }}>
      <header className="px-5 py-4 flex items-center justify-between gap-3"
        style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: sev.bg, color: sev.color, border: `1px solid ${sev.border}` }}
            aria-hidden="true">
            <Icon size={16} aria-hidden={true} />
          </div>
          <div className="min-w-0">
            <h2 id={`widget-${w.key}`} className="text-sm font-semibold truncate"
              style={{ color: "var(--text-primary)" }}>
              {w.title}
            </h2>
            {w.summary && (
              <p className="text-xs truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
                {w.summary}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ color: sev.color, background: sev.bg, border: `1px solid ${sev.border}` }}>
                優先 {w.priority_score}
              </span>
              {w.priority_reasons.slice(0, 1).map((reason) => (
                <span
                  key={reason}
                  className="rounded px-1.5 py-0.5 text-[10px]"
                  style={{ color: "var(--text-secondary)", background: "var(--bg-hover)" }}>
                  {reason}
                </span>
              ))}
            </div>
          </div>
        </div>
        {w.count !== null && w.count !== undefined && (
          <span className="text-2xl font-bold leading-none flex-shrink-0"
            style={{ color: sev.color }}>
            {w.count > 99 ? "99+" : w.count}
          </span>
        )}
      </header>

      {w.items.length > 0 && (
        <ul className="flex-1">
          {w.items.map((it, idx) => (
            <li key={`${w.key}-${idx}`}
              style={idx < w.items.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
              {it.href ? (
                <Link
                  href={it.href}
                  className="dashboard-widget-row flex items-center gap-3 px-5 py-3"
                  style={{ textDecoration: "none" }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
                      {it.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {it.badge && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                          style={{ color: sev.color, background: sev.bg, border: `1px solid ${sev.border}` }}>
                          {it.badge}
                        </span>
                      )}
                      {it.subtitle && (
                        <span className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                          {it.subtitle}
                        </span>
                      )}
                      {it.timestamp && (
                        <span className="text-xs flex-shrink-0 ml-auto"
                          style={{ color: "var(--text-disabled)" }}>
                          {formatDate(it.timestamp)}
                        </span>
                      )}
                    </div>
                    {it.recommended_action && (
                      <p className="mt-1 truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {it.recommended_action}
                      </p>
                    )}
                  </div>
                  <ChevronRight size={14} aria-hidden={true}
                    style={{ color: "var(--text-disabled)" }} />
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-5 py-3">
                  <p className="text-sm flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                    {it.title}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {w.href && (
        <Link
          href={w.href}
          className="dashboard-widget-footer px-5 py-2.5 text-xs font-medium flex items-center justify-end gap-1"
          style={{
            color: "var(--primary-text)",
            borderTop: "1px solid var(--border)",
            textDecoration: "none",
          }}>
          查看全部 <ChevronRight size={12} aria-hidden={true} />
        </Link>
      )}
    </section>
  );
}

function SkeletonCard() {
  return (
    <div
      className="rounded-lg p-5 animate-pulse"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
      }}
      aria-hidden="true">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg" style={{ background: "var(--bg-hover)" }} />
        <div className="flex-1">
          <div className="h-3 w-24 rounded mb-2" style={{ background: "var(--bg-hover)" }} />
          <div className="h-2 w-32 rounded" style={{ background: "var(--bg-hover)" }} />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-3 w-full rounded" style={{ background: "var(--bg-hover)" }} />
        <div className="h-3 w-4/5 rounded" style={{ background: "var(--bg-hover)" }} />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [userName, setUserName] = useState("");
  const [greeting, setGreeting] = useState("歡迎回來");
  const [data, setData] = useState<DashboardResponse | null>(() => cacheGet("dashboard/data") ?? null);
  const [tasks, setTasks] = useState<TaskInboxResponse | null>(() => cacheGet("dashboard/tasks") ?? null);
  const [matters, setMatters] = useState<MatterListItem[]>(() => cacheGet("dashboard/matters") ?? []);
  const [loading, setLoading] = useState(!cacheHas("dashboard/data"));
  const { can, canAny, isAdmin, permissions } = usePermissions();
  const recents = useRecentItems(6);

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
    // 有快取時背景靜默更新，不顯示 loading
    if (!cacheHas("dashboard/data")) setLoading(true);
    Promise.allSettled([
      dashboardApi.get(),
      tasksApi.list(),
      governanceApi.listMatters({ status: "active", limit: 6 }),
    ])
      .then(([dashboardRes, tasksRes, mattersRes]) => {
        if (dashboardRes.status === "fulfilled") {
          setData(dashboardRes.value);
          cacheSet("dashboard/data", dashboardRes.value);
        } else throw dashboardRes.reason;
        if (tasksRes.status === "fulfilled") {
          setTasks(tasksRes.value);
          cacheSet("dashboard/tasks", tasksRes.value);
        }
        if (mattersRes.status === "fulfilled") {
          setMatters(mattersRes.value);
          cacheSet("dashboard/matters", mattersRes.value);
        }
      })
      .catch((e) => {
        toast.error("無法載入儀表板");
        console.error(e);
      })
      .finally(() => setLoading(false));
  }, []);

  const widgets = data?.widgets ?? [];
  const layoutHint = data?.layout_hint ?? "student";
  const profile = useMemo(
    () => resolveNavigationProfile(permissions, isAdmin),
    [isAdmin, permissions],
  );
  const hasAny = widgets.length > 0;
  const visibleItems = widgets.reduce((sum, widget) => sum + widget.items.length, 0);
  const priorityTasks = (tasks?.items ?? [])
    .slice()
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 5);
  const priorityMatters = sortMattersByInsight(matters).slice(0, 4);
  const urgentCount = (tasks?.items ?? []).filter((task) => task.severity === "critical").length;
  const isOperator = isAdmin || permissions.size > 0 || layoutHint !== "student";
  const dashboardContent = getDashboardContent(profile, can, canAny, isOperator);
  const primaryAction = dashboardContent.primaryAction;
  const quickActions = dashboardContent.quickActions;
  const adminActions = getAdminActions(can, canAny, isAdmin);

  return (
    <div className="dashboard-page max-w-7xl mx-auto space-y-5">

      {/* 一次性引導：首次進站時提示 */}
      <OnboardingHint id="hint.dashboard.first-visit">
        歡迎使用平台首頁！下面的卡片會依您的角色顯示最相關的待辦與最新消息，
        點任一卡片可以直接開始。
      </OnboardingHint>

      {/* 頁首 */}
      <section className="dashboard-hero">
        <div className="dashboard-hero-glow dashboard-hero-glow-one" aria-hidden="true" />
        <div className="dashboard-hero-glow dashboard-hero-glow-two" aria-hidden="true" />
        <div className="dashboard-hero-content">
          <div className="min-w-0">
            <div className="dashboard-kicker">
              <span className="dashboard-kicker-icon">
                <Inbox size={12} aria-hidden={true} />
              </span>
              {dashboardContent.kicker}
            </div>
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <h1 className="dashboard-title">
                {greeting}，{userName || "使用者"}
              </h1>
            {data && (
              <span
                  className="dashboard-role-badge">
                <Sparkles size={10} aria-hidden={true} />
                {HINT_LABEL[profile] ?? HINT_LABEL[layoutHint] ?? "個人化視角"}
              </span>
            )}
            </div>
            <p className="dashboard-subtitle">
              {priorityTasks.length > 0
                ? dashboardContent.busySubtitle
                : dashboardContent.emptySubtitle}
            </p>
          </div>
          <div className="dashboard-pulse" aria-hidden="true">
            <span className="dashboard-pulse-ring" />
            <span className="dashboard-pulse-core">
              <Zap size={22} />
            </span>
            <span className="dashboard-pulse-label">LIVE</span>
          </div>
        </div>

        <div className="dashboard-hero-footer">
          <div className="dashboard-stat">
            <Layers3 size={16} aria-hidden={true} />
            <span><strong>{tasks?.total ?? 0}</strong> 件待辦</span>
          </div>
          <div className="dashboard-stat">
            <ListChecks size={16} aria-hidden={true} />
            <span><strong>{urgentCount}</strong> 件緊急</span>
          </div>
          <p className="dashboard-updated">
            內容依權限與角色即時彙整
          </p>
          <Link href={primaryAction.href} className="dashboard-primary-action">
            <primaryAction.icon size={14} aria-hidden={true} />
            {primaryAction.label}
            <ArrowUpRight size={14} aria-hidden={true} />
          </Link>
        </div>
      </section>

      <section className="dashboard-focus-grid" aria-label="今日重點">
        <div className="dashboard-focus-main">
          <div className="dashboard-section-heading">
            <div>
              <p className="dashboard-eyebrow">下一步</p>
              <h2>先處理這些</h2>
            </div>
            <Link href="/tasks" className="dashboard-text-link">
              全部待辦 <ChevronRight size={14} aria-hidden={true} />
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <TaskSkeleton key={i} />)}
            </div>
          ) : priorityTasks.length > 0 || priorityMatters.length > 0 ? (
            <ul className="space-y-2">
              {priorityTasks.map((task) => <PriorityTaskRow key={task.id} task={task} />)}
              {priorityMatters.map(({ matter, insight }) => (
                <GovernanceMatterFocusRow key={matter.id} matter={matter} insight={insight} />
              ))}
            </ul>
          ) : (
            <div className="dashboard-quiet-state">
              <ShieldCheck size={24} aria-hidden={true} />
              <div>
                <p>目前沒有需要立即處理的事項</p>
                <span>有新簽核、問卷、訂單或通知時會出現在這裡。</span>
              </div>
            </div>
          )}
        </div>

        <aside className="dashboard-actions-panel" aria-label={dashboardContent.actionHeading}>
          <div className="dashboard-section-heading">
            <div>
              <p className="dashboard-eyebrow">{dashboardContent.actionEyebrow}</p>
              <h2>{dashboardContent.actionHeading}</h2>
            </div>
          </div>
          <div className="dashboard-action-list">
            {quickActions.map((action) => (
              <QuickActionCard key={action.href} action={action} />
            ))}
          </div>
        </aside>
      </section>

      <section className="rounded-lg p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }} aria-label={dashboardContent.serviceTitle}>
        <div className="dashboard-section-heading">
          <div>
            <p className="dashboard-eyebrow">{dashboardContent.serviceEyebrow}</p>
            <h2>{dashboardContent.serviceTitle}</h2>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {dashboardContent.services.map((action) => (
            <QuickActionCard key={action.href} action={action} />
          ))}
        </div>
      </section>

      {dashboardContent.showGovernance && (
      <section className="rounded-lg p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }} aria-label="正在進行的活動與事情">
        <div className="dashboard-section-heading">
          <div>
            <p className="dashboard-eyebrow">正在進行</p>
            <h2>活動與事情</h2>
          </div>
          <Link href="/governance" className="dashboard-text-link">
            進入工作中心 <ChevronRight size={14} aria-hidden={true} />
          </Link>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {matters.length === 0 && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              尚未有進行中的工作。建立活動或事情後，會集中出現在這裡。
            </p>
          )}
          {priorityMatters.map(({ matter, insight }) => (
            <Link
              key={matter.id}
              href={`/governance/${matter.id}`}
              className="rounded-lg border p-3 transition-colors"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)", textDecoration: "none" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{matter.title}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {matter.matter_type === "activity" ? "活動" : "事情"} · {matter.open_task_count} 待辦 · {matter.link_count} 關聯
                  </p>
                  <p className="mt-1 truncate text-[11px]" style={{ color: riskColor(insight.risk_level) }}>
                    {insight.recommended_action.label}
                  </p>
                </div>
                <ChevronRight size={14} aria-hidden={true} style={{ color: "var(--text-muted)" }} />
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--bg-hover)" }}>
                <div className="h-full rounded-full" style={{ width: `${matter.progress_percent}%`, background: "var(--primary)" }} />
              </div>
            </Link>
          ))}
        </div>
      </section>
      )}

      {adminActions.length > 0 && (
        <section className="dashboard-admin-strip" aria-label="管理員工作台">
          <div>
            <p className="dashboard-eyebrow">後台工作台</p>
            <h2>管理員常用操作</h2>
          </div>
          <div className="dashboard-admin-actions">
            {adminActions.map((action) => (
              <QuickActionCard key={action.href} action={action} compact />
            ))}
          </div>
        </section>
      )}

      {/* 最近開啟：個人化捷徑，少翻選單 */}
      {recents.length > 0 && (
        <div className="dashboard-recents flex items-center gap-2 overflow-x-auto pb-1 -mb-1">
          <span className="flex items-center gap-1 text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
            <Clock size={12} aria-hidden={true} />
            最近開啟
          </span>
          {recents.map((item) => (
            <Link
              key={`${item.kind}-${item.id}`}
              href={item.href}
              className="dashboard-recent-chip flex-shrink-0 max-w-[180px] truncate px-3 py-1.5 rounded-full text-xs font-medium"
              title={item.title}>
              {item.title}
            </Link>
          ))}
        </div>
      )}

      {/* Widget Grid */}
      <div className="dashboard-section-heading">
        <div>
          <p className="dashboard-eyebrow">智慧摘要</p>
          <h2>跨模組動態</h2>
        </div>
        <span className="dashboard-mini-meta">
          {widgets.length} 個摘要 · {visibleItems} 筆項目
        </span>
      </div>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : hasAny ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {widgets.map((w, index) => (
            <WidgetCard key={w.key} w={w} index={index} />
          ))}
        </div>
      ) : (
        <EmptyState />
      )}

      {loading && (
        <p className="flex items-center justify-center gap-2 text-xs"
          style={{ color: "var(--text-muted)" }}>
          <Loader2 size={12} className="animate-spin" aria-hidden={true} />
          載入儀表板…
        </p>
      )}
    </div>
  );
}

function GovernanceMatterFocusRow({
  matter,
  insight,
}: {
  matter: MatterListItem;
  insight: ReturnType<typeof sortMattersByInsight>[number]["insight"];
}) {
  return (
    <li>
      <Link
        href={`/governance/${matter.id}`}
        className="dashboard-task-row"
        style={{ borderLeftColor: riskColor(insight.risk_level) }}
      >
        <span
          className="dashboard-task-icon"
          style={{
            color: riskColor(insight.risk_level),
            background: "var(--bg-hover)",
            borderColor: "var(--border)",
          }}
          aria-hidden="true"
        >
          <Layers3 size={16} aria-hidden={true} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="dashboard-task-title">{matter.title}</span>
          <span className="dashboard-task-meta">
            <span>治理</span>
            <span>{matter.open_task_count} 待辦</span>
            <span>{matter.link_count} 關聯</span>
          </span>
          <span className="dashboard-task-recommend">
            {insight.recommended_action.label}：{insight.recommended_action.reason}
          </span>
        </span>
        <span className="dashboard-task-due" style={{ color: riskColor(insight.risk_level) }}>
          {insight.risk_label}
        </span>
        <ChevronRight size={16} aria-hidden={true} style={{ color: "var(--text-disabled)" }} />
      </Link>
    </li>
  );
}

type DashboardAction = {
  href: string;
  label: string;
  detail: string;
  icon: React.ComponentType<IconProps>;
  tone?: "primary" | "warning" | "danger" | "neutral";
};

type DashboardContent = {
  kicker: string;
  emptySubtitle: string;
  busySubtitle: string;
  actionHeading: string;
  actionEyebrow: string;
  primaryAction: DashboardAction;
  quickActions: DashboardAction[];
  serviceTitle: string;
  serviceEyebrow: string;
  services: DashboardAction[];
  showGovernance: boolean;
};

function getDashboardContent(
  profile: NavigationProfile,
  can: (code: string) => boolean,
  canAny: (...codes: string[]) => boolean,
  isOperator: boolean,
): DashboardContent {
  const primaryAction = getPrimaryAction(profile, can, isOperator);
  return {
    default: {
      kicker: "治理工作台",
      busySubtitle: "需要你動作的事項已排在最前面，正在進行的活動與事情放在同一個工作流裡。",
      emptySubtitle: "今天沒有急迫待辦，可以從活動、事情或常用入口直接開始。",
      actionEyebrow: "管理捷徑",
      actionHeading: "少走幾層選單",
      primaryAction,
      quickActions: getQuickActions(profile, can, canAny, isOperator),
      serviceEyebrow: "服務目錄",
      serviceTitle: "常用治理入口",
      services: getServiceActions("default", can, canAny),
      showGovernance: true,
    },
    student: {
      kicker: "學生服務台",
      busySubtitle: "需要填寫、確認或追蹤的事項已排在最前面。",
      emptySubtitle: "今天沒有急迫事項，可以從公告、問卷、餐點或陳情直接開始。",
      actionEyebrow: "常用服務",
      actionHeading: "直接開始",
      primaryAction,
      quickActions: getQuickActions(profile, can, canAny, isOperator),
      serviceEyebrow: "服務目錄",
      serviceTitle: "你常用的校園服務",
      services: getServiceActions("student", can, canAny),
      showGovernance: false,
    },
    teacher: {
      kicker: "師長工作台",
      busySubtitle: "班級、問卷、題庫與通知相關事項已集中在這裡。",
      emptySubtitle: "目前沒有急迫事項，可以查看班級收單、問卷或公告。",
      actionEyebrow: "教職員入口",
      actionHeading: "班級與教學服務",
      primaryAction,
      quickActions: getQuickActions(profile, can, canAny, isOperator),
      serviceEyebrow: "服務目錄",
      serviceTitle: "師長常用工具",
      services: getServiceActions("teacher", can, canAny),
      showGovernance: false,
    },
    vendor: {
      kicker: "合作夥伴工作台",
      busySubtitle: "合作資料、特約內容與待處理事項會集中顯示。",
      emptySubtitle: "目前沒有急迫事項，可以管理特約資訊或查看公告。",
      actionEyebrow: "合作入口",
      actionHeading: "商家與合作事項",
      primaryAction,
      quickActions: getQuickActions(profile, can, canAny, isOperator),
      serviceEyebrow: "服務目錄",
      serviceTitle: "合作夥伴服務",
      services: getServiceActions("vendor", can, canAny),
      showGovernance: false,
    },
    mealVendor: {
      kicker: "餐商工作台",
      busySubtitle: "菜單、訂單、核銷與結單提醒已排在最前面。",
      emptySubtitle: "目前沒有急迫事項，可以查看今日訂單或管理菜單。",
      actionEyebrow: "餐商入口",
      actionHeading: "今日供餐工作",
      primaryAction,
      quickActions: getQuickActions(profile, can, canAny, isOperator),
      serviceEyebrow: "服務目錄",
      serviceTitle: "餐商營運服務",
      services: getServiceActions("mealVendor", can, canAny),
      showGovernance: false,
    },
  }[profile];
}

function getPrimaryAction(
  profile: NavigationProfile,
  can: (code: string) => boolean,
  isOperator: boolean,
): DashboardAction {
  if (profile === "mealVendor") {
    return { href: "/meal/vendor", label: "管理今日餐單", detail: "菜單、訂單與核銷", icon: Utensils };
  }
  if (profile === "vendor") {
    return { href: "/partner-map/admin", label: "管理特約資訊", detail: "商家、優惠與曝光", icon: ShoppingCart };
  }
  if (profile === "teacher") {
    if (!can("class:shop_collect")) {
      return { href: "/surveys", label: "查看問卷", detail: "回覆、審閱與追蹤", icon: PenLine };
    }
    return { href: "/shop/class-orders", label: "班級收單", detail: "查看班級商品訂單", icon: ListChecks };
  }
  if (can("document:draft")) {
    return { href: "/documents/new", label: "新增公文", detail: "建立草稿", icon: Plus };
  }
  if (can("announcement:create")) {
    return { href: "/publications", label: "發布公告", detail: "前往發布中心", icon: Send };
  }
  if (isOperator) {
    return { href: "/tasks", label: "查看待辦", detail: "統一工作佇列", icon: ListChecks };
  }
  return { href: "/surveys", label: "填寫問卷", detail: "參與校園決策", icon: PenLine };
}

function getQuickActions(
  profile: NavigationProfile,
  can: (code: string) => boolean,
  canAny: (...codes: string[]) => boolean,
  isOperator: boolean,
): DashboardAction[] {
  if (profile !== "default") return getServiceActions(profile, can, canAny).slice(0, 6);

  const actions: DashboardAction[] = [
    { href: "/tasks", label: "我的待辦", detail: "簽核、問卷、訂單集中處理", icon: ListChecks, tone: "primary" },
    { href: "/announcements", label: "最新公告", detail: "校內訊息與公開事項", icon: Bell },
    { href: "/surveys", label: "問卷專區", detail: "快速填寫與查看結果", icon: PenLine },
    { href: "/meal", label: "學餐訂購", detail: "菜單、訂單與取餐資訊", icon: Utensils },
    { href: "/shop", label: "商品訂購", detail: "活動票券與班級訂單", icon: ShoppingCart },
    { href: "/search", label: "全站搜尋", detail: "找公文、法規與公告", icon: Search },
  ];

  if (isOperator || can("document:draft")) {
    actions.unshift({ href: "/documents/new", label: "建立公文", detail: "套範本、送簽核", icon: FileText, tone: "primary" });
  }
  if (canAny("meeting:manage", "meeting:create")) {
    actions.splice(1, 0, { href: "/meetings", label: "議事管理", detail: "議程、出席、決議", icon: Landmark });
  }
  return actions.slice(0, 6);
}

function getServiceActions(
  profile: NavigationProfile,
  can: (code: string) => boolean,
  canAny: (...codes: string[]) => boolean,
): DashboardAction[] {
  const commonStudent: DashboardAction[] = [
    { href: "/announcements", label: "看最新公告", detail: "校內訊息與公開事項", icon: Bell },
    { href: "/surveys", label: "填寫問卷", detail: "參與校園決策與回饋", icon: PenLine },
    { href: "/petitions/new", label: "我要陳情", detail: "提交問題、建議或申訴", icon: MessageSquare },
    { href: "/meal", label: "查看餐單", detail: "菜單、訂單與取餐資訊", icon: Utensils },
    { href: "/shop", label: "購買商品票券", detail: "活動商品與票券訂購", icon: ShoppingCart },
    { href: "/partner-map", label: "找特約商家", detail: "優惠、地點與合作店家", icon: Search },
  ];

  if (profile === "student") return commonStudent;
  if (profile === "teacher") {
    const teacherActions: DashboardAction[] = [
      { href: "/announcements", label: "看校內公告", detail: "掌握近期校務與活動", icon: Bell },
      { href: "/surveys", label: "問卷與回覆", detail: "查看需協助的問卷事項", icon: PenLine },
      { href: "/exam-papers", label: "段考題庫", detail: "查找與管理教學資料", icon: FileText },
      { href: "/meal", label: "查看學餐", detail: "菜單與訂餐狀態", icon: Utensils },
      { href: "/calendar", label: "查看行事曆", detail: "會議、活動與重要日期", icon: CalendarDays },
    ];
    if (can("class:shop_collect")) {
      teacherActions.splice(1, 0, {
        href: "/shop/class-orders",
        label: "班級收單",
        detail: "協助班級商品與票券訂購",
        icon: ListChecks,
      });
    }
    return teacherActions;
  }
  if (profile === "vendor") {
    return [
      { href: "/partner-map/admin", label: "管理特約內容", detail: "商家資料、地點與優惠", icon: ShoppingCart },
      { href: "/partner-map", label: "查看公開頁面", detail: "確認學生看到的商家資訊", icon: Search },
      { href: "/tasks", label: "處理待辦", detail: "合作事項與通知集中處理", icon: ListChecks },
      { href: "/announcements", label: "合作公告", detail: "查看校內與合作資訊", icon: Bell },
      { href: "/settings", label: "帳號設定", detail: "通知、安全與介面偏好", icon: Settings },
    ];
  }
  if (profile === "mealVendor") {
    return [
      { href: "/meal/vendor", label: "管理今日餐單", detail: "菜單、排程、供應商與結單", icon: Utensils },
      { href: "/meal/orders", label: "查看學餐訂單", detail: "核銷、確認與匯出訂單", icon: ListChecks },
      { href: "/meal", label: "查看學生頁面", detail: "確認餐點呈現與開放狀態", icon: Search },
      { href: "/tasks", label: "處理待辦", detail: "結單、核銷與通知集中處理", icon: Inbox },
      { href: "/announcements", label: "供餐公告", detail: "查看校內與營運通知", icon: Bell },
      { href: "/settings", label: "帳號設定", detail: "通知、安全與介面偏好", icon: Settings },
    ];
  }

  const actions: DashboardAction[] = [
    { href: "/tasks", label: "我的待辦", detail: "簽核、問卷、訂單集中處理", icon: ListChecks, tone: "primary" },
    { href: "/governance", label: "工作中心", detail: "活動、事情與跨模組追蹤", icon: Layers3 },
    { href: "/documents", label: "公文作業", detail: "草稿、簽核與公文查找", icon: FileText },
    { href: "/regulations", label: "法規資料庫", detail: "查詢、修正與公布法規", icon: Scale },
    { href: "/announcements", label: "發布與公告", detail: "公告、電子郵件與通知", icon: Megaphone },
    { href: "/search", label: "全站搜尋", detail: "找公文、法規、會議與公告", icon: Search },
  ];
  if (canAny("meeting:manage", "meeting:create")) {
    actions.splice(2, 0, { href: "/meetings", label: "議事管理", detail: "議程、出席、決議", icon: Landmark });
  }
  if (can("meal:manage")) {
    actions.push({ href: "/meal/vendor", label: "餐商管理", detail: "菜單、訂單與供應商", icon: Utensils });
  }
  return actions.slice(0, 6);
}

function getAdminActions(
  can: (code: string) => boolean,
  canAny: (...codes: string[]) => boolean,
  isAdmin: boolean,
): DashboardAction[] {
  const actions: DashboardAction[] = [];
  if (isAdmin || can("admin:users")) {
    actions.push({ href: "/admin", label: "管理後台", detail: "人員、權限與系統總覽", icon: Settings });
    actions.push({ href: "/admin/people", label: "人員管理", detail: "帳號與身分資料", icon: Users });
  }
  if (canAny("announcement:create", "email:*")) {
    actions.push({ href: "/publications", label: "發布中心", detail: "公告與電子郵件", icon: Megaphone });
  }
  if (can("shop:manage")) {
    actions.push({ href: "/shop/admin", label: "商品後台", detail: "商品、訂單與結單", icon: ShoppingCart });
  }
  if (can("meal:manage")) {
    actions.push({ href: "/meal/vendor", label: "餐商管理", detail: "菜單、取餐與供應商", icon: Utensils });
  }
  if (isAdmin || can("admin:all")) {
    actions.push({ href: "/admin/modules", label: "模組維護", detail: "開關、維護與公告", icon: Wrench, tone: "warning" });
  }
  return actions.slice(0, 6);
}

function PriorityTaskRow({ task }: { task: TaskItem }) {
  const sev = SEVERITY_STYLES[task.severity] ?? SEVERITY_STYLES.info;
  const Icon = TASK_ICONS[task.module] ?? FallbackWidgetIcon;
  return (
    <li>
      <Link
        href={task.href}
        className="dashboard-task-row"
        style={{ borderLeftColor: sev.color }}
      >
        <span
          className="dashboard-task-icon"
          style={{ color: sev.color, background: sev.bg, borderColor: sev.border }}
          aria-hidden="true"
        >
          <Icon size={16} aria-hidden={true} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="dashboard-task-title">{task.title}</span>
          <span className="dashboard-task-meta">
            <span>{MODULE_LABEL[task.module]}</span>
            {task.subtitle && <span className="truncate">{task.subtitle}</span>}
          </span>
          {task.recommended_action && (
            <span className="dashboard-task-recommend">{task.recommended_action}</span>
          )}
        </span>
        <span className="dashboard-task-due" style={{ color: task.severity === "critical" ? sev.color : "var(--text-muted)" }}>
          {task.severity === "critical" && <AlertCircle size={12} aria-hidden={true} />}
          {formatTaskDue(task.due_at)}
        </span>
        <ChevronRight size={16} aria-hidden={true} style={{ color: "var(--text-disabled)" }} />
      </Link>
    </li>
  );
}

function QuickActionCard({
  action,
  compact = false,
}: {
  action: DashboardAction;
  compact?: boolean;
}) {
  const tone = action.tone ?? "neutral";
  return (
    <Link href={action.href} className={`dashboard-action-card ${compact ? "is-compact" : ""} tone-${tone}`}>
      <span className="dashboard-action-icon" aria-hidden="true">
        <action.icon size={16} aria-hidden={true} />
      </span>
      <span className="min-w-0">
        <span className="dashboard-action-label">{action.label}</span>
        <span className="dashboard-action-detail">{action.detail}</span>
      </span>
    </Link>
  );
}

function TaskSkeleton() {
  return (
    <div className="dashboard-task-row animate-pulse" aria-hidden="true">
      <span className="dashboard-task-icon" style={{ background: "var(--bg-hover)" }} />
      <span className="flex-1 space-y-2">
        <span className="block h-3 w-2/3 rounded" style={{ background: "var(--bg-hover)" }} />
        <span className="block h-2 w-1/2 rounded" style={{ background: "var(--bg-hover)" }} />
      </span>
    </div>
  );
}

function EmptyState() {
  const links = [
    { href: "/announcements", label: "看公告" },
    { href: "/regulations", label: "查法規" },
    { href: "/shop", label: "商品訂購" },
    { href: "/meal", label: "學餐訂購" },
    { href: "/surveys", label: "問卷" },
  ];
  return (
    <div className="card p-8 text-center"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
      }}>
      <Sparkles size={32} aria-hidden={true}
        style={{ color: "var(--primary)", display: "inline-block", marginBottom: 12 }} />
      <p className="text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>
        今天一片寧靜
      </p>
      <p className="text-xs mb-5" style={{ color: "var(--text-muted)" }}>
        沒有待辦也沒有新訊息。要不要逛一下這些地方？
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: "var(--primary-dim)",
              color: "var(--primary)",
              border: "1px solid var(--border-strong)",
              textDecoration: "none",
            }}>
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
