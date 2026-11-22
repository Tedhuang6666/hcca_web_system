"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  FileText, ListChecks, Scale, Megaphone, MessageSquare,
  CheckSquare, ChevronRight, Plus, Loader2, Clock,
  ShoppingCart, ShieldCheck,
  Settings, Users, Bell, Search, PenLine, Send, Wrench, AlertCircle,
} from "lucide-react";
import { announcementsApi } from "@/lib/api/announcements";
import { dashboardApi, type DashboardResponse } from "@/lib/api/dashboard";
import {
  tasksApi,
  type TaskInboxResponse,
  type TaskItem,
  type TaskModule,
} from "@/lib/api/tasks";
import type { AnnouncementListItem } from "@/lib/types";
import { cacheGet, cacheSet } from "@/lib/api-cache";
import { usePermissions } from "@/hooks/usePermissions";
import { useRecentItems } from "@/hooks/useRecentItems";
import { resolveNavigationProfile, type NavigationProfile } from "@/lib/navigation-profile";
import { OPEN_COMMAND_MENU_EVENT } from "@/components/layout/CommandMenu";

const DashboardWidgets = dynamic(() => import("./DashboardWidgets"), { ssr: false });

type IconProps = { size?: number; "aria-hidden"?: boolean };

function FallbackWidgetIcon(p: IconProps) {
  return <FileText {...p} />;
}

const SEVERITY_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  info: { color: "var(--primary-text)", bg: "var(--primary-dim)", border: "var(--info-border)" },
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

const MODULE_LABEL: Record<TaskModule, string> = {
  document: "公文",
  regulation: "法規",
  petition: "陳情",
  survey: "問卷",
  shop: "商品",
  announcement: "公告",
  work_item: "工作",
};

const TASK_ICONS: Record<TaskModule, React.ComponentType<IconProps>> = {
  document: (p) => <FileText {...p} />,
  regulation: (p) => <Scale {...p} />,
  petition: (p) => <MessageSquare {...p} />,
  survey: (p) => <CheckSquare {...p} />,
  shop: (p) => <ShoppingCart {...p} />,
  announcement: (p) => <Megaphone {...p} />,
  work_item: (p) => <ListChecks {...p} />,
};

const EMPTY_PERMISSIONS = new Set<string>();
/** 已在「優先處理」列出的事項，不再以摘要重複顯示。 */
const TASK_DUPLICATE_WIDGETS = new Set(["doc_pending_my_approval", "regulation_review", "regulation_publish"]);

function uniqueActions(actions: DashboardAction[]): DashboardAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = action.href.split("?")[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatDate(s?: string | null) {
  if (!s) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(s));
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${month}/${day}`;
}

function taipeiDateStamp(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return { year, month, day, stamp: Date.UTC(year, month - 1, day) };
}

function formatTaskDue(s?: string | null) {
  if (!s) return "無期限";
  const d = new Date(s);
  const today = taipeiDateStamp(new Date());
  const due = taipeiDateStamp(d);
  const diffDays = Math.round((due.stamp - today.stamp) / 86_400_000);
  if (diffDays < 0) return `已逾期 ${Math.abs(diffDays)} 天`;
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "明天";
  if (diffDays <= 7) return `${diffDays} 天內`;
  return `${due.month}/${due.day}`;
}

export type DashboardPageInitialData = {
  userName: string;
  greeting: string;
  dashboard: DashboardResponse | null;
  tasks: TaskInboxResponse | null;
  announcements: AnnouncementListItem[] | null;
};

export default function DashboardPageClient({
  initialData,
}: {
  initialData: DashboardPageInitialData | null;
}) {
  // 不在首次 render 讀取模組快取：伺服器 render 沒有瀏覽器快取，若瀏覽器
  // 在 hydration 時已有資料，會讓兩邊輸出的樹不同並觸發 React hydration error #418。
  // hydration 完成後再載入快取，仍可保留切頁回來的即時顯示效果。
  const [cachedDashboard, setCachedDashboard] = useState<DashboardResponse | undefined>();
  const [cachedTasks, setCachedTasks] = useState<TaskInboxResponse | undefined>();
  const [cachedAnnouncements, setCachedAnnouncements] = useState<
    AnnouncementListItem[] | undefined
  >();
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const [userName, setUserName] = useState(initialData?.userName ?? "");
  const [greeting] = useState(initialData?.greeting ?? "歡迎回來");
  const [data, setData] = useState<DashboardResponse | null>(
    () => initialData?.dashboard ?? null,
  );
  const [tasks, setTasks] = useState<TaskInboxResponse | null>(
    () => initialData?.tasks ?? null,
  );
  const [announcements, setAnnouncements] = useState<AnnouncementListItem[]>(
    () => initialData?.announcements ?? [],
  );
  const [priorityLoading, setPriorityLoading] = useState(
    !initialData?.tasks && !cachedTasks,
  );
  const [secondaryLoading, setSecondaryLoading] = useState(
    !initialData?.dashboard && !cachedDashboard,
  );
  const [clientReady, setClientReady] = useState(false);
  const {
    can: hasPermission,
    canAny: hasAnyPermission,
    isAdmin: cachedIsAdmin,
    permissions: cachedPermissions,
  } = usePermissions();
  // Permission-driven dashboard branches must wait until hydration has
  // committed; auth/me can update the cache while the streamed tree is still
  // being hydrated, which otherwise changes the server-rendered branch.
  useEffect(() => setClientReady(true), []);

  useEffect(() => {
    setCachedDashboard(cacheGet<DashboardResponse>("dashboard/data"));
    setCachedTasks(cacheGet<TaskInboxResponse>("dashboard/tasks"));
    setCachedAnnouncements(cacheGet<AnnouncementListItem[]>("dashboard/announcements"));
    setCacheHydrated(true);
  }, []);
  const isAdmin = clientReady && cachedIsAdmin;
  const permissions = clientReady ? cachedPermissions : EMPTY_PERMISSIONS;
  const can = (code: string) => clientReady && hasPermission(code);
  const canAny = (...codes: string[]) => clientReady && hasAnyPermission(...codes);
  const hasTaskAccess = isAdmin
    || permissions.has("admin:all")
    || Array.from(permissions).some(
      (permission) => permission.startsWith("document:") || permission.startsWith("regulation:"),
    );
  const recents = useRecentItems(6);

  useEffect(() => {
    if (!initialData?.userName) {
      const name = localStorage.getItem("user_name");
      if (name) setUserName(name);
    }
  }, [initialData?.userName]);

  useEffect(() => {
    if (!cacheHydrated) return;
    const userId = localStorage.getItem("user_id");
    if (!userId) {
      setPriorityLoading(false);
      setSecondaryLoading(false);
      return;
    }
    if (!initialData?.dashboard && cachedDashboard) setData(cachedDashboard);
    if (!initialData?.tasks && cachedTasks) setTasks(cachedTasks);
    if (initialData?.announcements == null && cachedAnnouncements) {
      setAnnouncements(cachedAnnouncements);
    }
    // The server already rendered the compact dashboard for the first paint.
    // Refetching a full composite immediately after hydration duplicated the
    // heaviest dashboard request and delayed the first usable interaction.
    const refreshDashboard = !initialData?.dashboard && !cachedDashboard;
    const refreshTasks = !initialData?.tasks && !cachedTasks;
    const refreshAnnouncements = initialData?.announcements == null && !cachedAnnouncements;
    if (refreshTasks) setPriorityLoading(true);
    if (refreshDashboard || refreshAnnouncements) setSecondaryLoading(true);

    const compositePromise = refreshDashboard
      ? dashboardApi.composite({ includeTasks: false })
      : null;
    const tasksPromise = refreshTasks ? tasksApi.list() : null;
    const announcementsPromise = !refreshDashboard && refreshAnnouncements
      ? announcementsApi.list({ limit: 3 })
      : null;

    Promise.allSettled([compositePromise, tasksPromise, announcementsPromise])
      .then(([compositeRes, tasksRes, announcementsRes]) => {
        if (compositeRes.status === "fulfilled" && compositeRes.value) {
          setData(compositeRes.value.dashboard);
          cacheSet("dashboard/data", compositeRes.value.dashboard);
          if (compositeRes.value.tasks) {
            setTasks(compositeRes.value.tasks);
            cacheSet("dashboard/tasks", compositeRes.value.tasks);
          }
          if (compositeRes.value.announcements) {
            setAnnouncements(compositeRes.value.announcements);
            cacheSet("dashboard/announcements", compositeRes.value.announcements);
          }
        } else if (refreshDashboard && compositeRes.status === "rejected") {
          void import("sonner").then(({ toast }) => toast.error("無法載入儀表板"));
          console.error(compositeRes.reason);
        }
        if (tasksRes.status === "fulfilled" && tasksRes.value) {
          setTasks(tasksRes.value);
          cacheSet("dashboard/tasks", tasksRes.value);
        }
        if (announcementsRes.status === "fulfilled" && announcementsRes.value) {
          setAnnouncements(announcementsRes.value);
          cacheSet("dashboard/announcements", announcementsRes.value);
        }
      })
      .finally(() => {
        if (refreshTasks) setPriorityLoading(false);
        setSecondaryLoading(false);
      });
  }, [cacheHydrated, cachedAnnouncements, cachedDashboard, cachedTasks, initialData]);

  const widgets = data?.widgets ?? [];
  const layoutHint = data?.layout_hint ?? "student";
  const profile = useMemo(
    () => resolveNavigationProfile(permissions, isAdmin),
    [isAdmin, permissions],
  );
  // 與待辦重複的摘要不再顯示第二次；其餘有內容的摘要集中在「與我有關」。
  const personalWidgets = widgets.filter((widget) => (
    widget.key !== "announcements_recent"
    && widget.items.length > 0
    && !(hasTaskAccess && TASK_DUPLICATE_WIDGETS.has(widget.key))
  ));
  const priorityTasks = (tasks?.items ?? [])
    .filter((task) => {
      if (task.module === "document") return can("document:approve");
      if (task.module !== "regulation") return true;
      return task.action === "publish"
        ? can("regulation:president_publish")
        : canAny("regulation:schedule", "regulation:council_approve");
    })
    .slice()
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 3);
  const latestAnnouncements = useMemo(
    () => [...announcements]
      .sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at))
      .slice(0, 3),
    [announcements],
  );
  const isOperator = isAdmin || permissions.size > 0 || layoutHint !== "student";
  const primaryAction = getPrimaryAction(profile, can, hasTaskAccess);
  const showTaskPanel = hasTaskAccess || priorityTasks.length > 0;
  // 一組常用功能：同一個入口只出現一次，主要操作與待辦面板已有的入口不重複。
  const shortcuts = uniqueActions([
    ...getQuickActions(profile, can, canAny, isOperator),
    ...getAdminActions(can, canAny, isAdmin),
    ...getServiceActions(profile, can),
  ]).filter((action) => (
    action.href !== primaryAction?.href
    && action.href !== "/search"
    && !(action.href === "/tasks" && (showTaskPanel || !hasTaskAccess))
  )).slice(0, 8);

  return (
    <div className="dashboard-page max-w-7xl mx-auto space-y-5">
      <section className="dashboard-hero">
        <div className="dashboard-hero-content">
          <h1 className="dashboard-title min-w-0">
            {greeting}，{userName || "使用者"}
          </h1>
          {primaryAction && (
            <div className="dashboard-hero-actions">
              <Link href={primaryAction.href} className="dashboard-primary-action">
                <primaryAction.icon size={14} aria-hidden={true} />
                {primaryAction.label}
              </Link>
            </div>
          )}
        </div>
      </section>

      <div className="dashboard-focus-grid">
        <div className="dashboard-main-column">
          {showTaskPanel && (
            <section className="dashboard-focus-main" aria-labelledby="dashboard-tasks-title">
              <div className="dashboard-section-heading">
                <h2 id="dashboard-tasks-title">優先處理</h2>
                {hasTaskAccess && (
                  <Link href="/tasks" className="dashboard-text-link">
                    全部待辦 <ChevronRight size={14} aria-hidden={true} />
                  </Link>
                )}
              </div>
              {priorityLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <TaskSkeleton key={i} />)}
                </div>
              ) : priorityTasks.length > 0 ? (
                <ul className="space-y-2">
                  {priorityTasks.map((task) => <PriorityTaskRow key={task.id} task={task} />)}
                </ul>
              ) : (
                <p className="dashboard-quiet-state">
                  <ShieldCheck size={20} aria-hidden={true} />
                  目前沒有需要立即處理的事項
                </p>
              )}
            </section>
          )}

          {personalWidgets.length > 0 && (
            <section className="dashboard-personal-progress" aria-labelledby="dashboard-progress-title">
              <div className="dashboard-section-heading">
                <h2 id="dashboard-progress-title">與我有關</h2>
              </div>
              <DashboardWidgets widgets={personalWidgets} />
            </section>
          )}

          {latestAnnouncements.length > 0 && (
            <section className="dashboard-focus-main dashboard-announcements-panel" aria-labelledby="dashboard-announcements-title">
              <div className="dashboard-section-heading">
                <h2 id="dashboard-announcements-title">最新公告</h2>
                <Link href="/announcements" className="dashboard-text-link">
                  查看全部 <ChevronRight size={14} aria-hidden={true} />
                </Link>
              </div>
              <ul className="dashboard-announcement-list">
                {latestAnnouncements.map((announcement) => (
                  <li key={announcement.id}>
                    <Link href={`/announcements/${announcement.id}`} className="dashboard-announcement-row">
                      {announcement.is_urgent && (
                        <span
                          className="dashboard-announcement-badge"
                          style={{ color: "var(--warning)", background: "var(--warning-dim)" }}
                        >
                          重要
                        </span>
                      )}
                      <span className="dashboard-announcement-title">{announcement.title}</span>
                      <time className="dashboard-announcement-date" dateTime={announcement.published_at ?? announcement.created_at}>
                        {formatDate(announcement.published_at ?? announcement.created_at)}
                      </time>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <nav className="dashboard-actions-panel" aria-labelledby="dashboard-shortcuts-title">
          <div className="dashboard-section-heading">
            <h2 id="dashboard-shortcuts-title">常用功能</h2>
          </div>
          <div className="dashboard-action-list">
            {shortcuts.map((action) => (
              <QuickActionCard key={action.href} action={action} />
            ))}
          </div>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_MENU_EVENT))}
            className="dashboard-text-link mt-3"
          >
            <Search size={14} aria-hidden={true} />
            搜尋其他功能
          </button>
        </nav>
      </div>

      {recents.length > 0 && (
        <section className="dashboard-recents-panel" aria-labelledby="dashboard-recents-title">
          <h2 id="dashboard-recents-title" className="dashboard-recents-label flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <Clock size={12} aria-hidden={true} />
            最近開啟
          </h2>
          <div className="dashboard-recents-list">
            {recents.map((item) => (
              <Link
                key={`${item.kind}-${item.id}`}
                href={item.href}
                className="dashboard-recent-chip px-3 py-1.5 text-xs font-medium"
                title={item.title}>
                {item.title}
              </Link>
            ))}
          </div>
        </section>
      )}

      {secondaryLoading && (
        <p className="flex items-center justify-center gap-2 text-xs" role="status"
          style={{ color: "var(--text-muted)" }}>
          <Loader2 size={12} className="animate-spin" aria-hidden={true} />
          載入中…
        </p>
      )}
    </div>
  );
}

type DashboardAction = {
  href: string;
  label: string;
  icon: React.ComponentType<IconProps>;
  tone?: "primary" | "warning" | "danger" | "neutral";
};

function getPrimaryAction(
  profile: NavigationProfile,
  can: (code: string) => boolean,
  hasTaskAccess: boolean,
): DashboardAction | null {
  // 只有真正要「做」的事才放主要按鈕；單純前往清單的入口留在常用功能。
  if (can("class:shop_collect") && !can("shop:manage")) {
    return { href: "/shop/class-orders", label: "班代代訂與收款", icon: ListChecks };
  }
  if (profile === "vendor") {
    return { href: "/partner-map/admin", label: "管理特約資訊", icon: ShoppingCart };
  }
  if (profile === "teacher") return null;
  if (can("document:draft")) {
    return { href: "/documents/new", label: "新增公文", icon: Plus };
  }
  if (can("announcement:create")) {
    return { href: "/publications", label: "發布公告", icon: Send };
  }
  if (hasTaskAccess) {
    return { href: "/tasks", label: "查看待辦", icon: ListChecks };
  }
  return null;
}

function getQuickActions(
  profile: NavigationProfile,
  can: (code: string) => boolean,
  canAny: (...codes: string[]) => boolean,
  isOperator: boolean,
): DashboardAction[] {
  if (profile !== "default") return getServiceActions(profile, can).slice(0, 6);

  const actions: DashboardAction[] = [
    { href: "/tasks", label: "我的待辦", icon: ListChecks, tone: "primary" },
    { href: "/announcements", label: "校內公告", icon: Bell },
    { href: "/surveys", label: "問卷專區", icon: PenLine },
    { href: "/shop", label: "商品訂購", icon: ShoppingCart },
    { href: "/search", label: "全站搜尋", icon: Search },
  ];

  if (isOperator || can("document:draft")) {
    actions.unshift({ href: "/documents/new", label: "建立公文", icon: FileText, tone: "primary" });
  }
  return actions.slice(0, 6);
}

function getServiceActions(
  profile: NavigationProfile,
  can: (code: string) => boolean,
): DashboardAction[] {
  const commonStudent: DashboardAction[] = [
    { href: "/announcements", label: "校內公告", icon: Bell },
    { href: "/surveys", label: "問卷專區", icon: PenLine },
    { href: "/petitions/new", label: "我要陳情", icon: MessageSquare },
    { href: "/shop", label: "商品訂購", icon: ShoppingCart },
    { href: "/partner-map", label: "特約地圖", icon: Search },
  ];

  if (profile === "student") return commonStudent;
  if (profile === "teacher") {
    const teacherActions: DashboardAction[] = [
      { href: "/announcements", label: "校內公告", icon: Bell },
      { href: "/surveys", label: "問卷專區", icon: PenLine },
      { href: "/exam-papers", label: "段考題庫", icon: FileText },
    ];
    if (can("class:shop_collect")) {
      teacherActions.splice(1, 0, {
        href: "/shop/class-orders",
        label: "班級收款與代訂",
        icon: ListChecks,
      });
    }
    return teacherActions;
  }
  if (profile === "vendor") {
    return [
      { href: "/partner-map/admin", label: "特約管理", icon: ShoppingCart },
      { href: "/partner-map", label: "特約地圖", icon: Search },
      { href: "/tasks", label: "我的待辦", icon: ListChecks },
      { href: "/announcements", label: "校內公告", icon: Bell },
      { href: "/settings", label: "帳號設定", icon: Settings },
    ];
  }
  const actions: DashboardAction[] = [
    { href: "/tasks", label: "我的待辦", icon: ListChecks, tone: "primary" },
    { href: "/documents", label: "公文系統", icon: FileText },
    { href: "/regulations", label: "法規查詢", icon: Scale },
    { href: "/announcements", label: "校內公告", icon: Megaphone },
    { href: "/search", label: "全站搜尋", icon: Search },
  ];
  return actions.slice(0, 6);
}

function getAdminActions(
  can: (code: string) => boolean,
  canAny: (...codes: string[]) => boolean,
  isAdmin: boolean,
): DashboardAction[] {
  // 名稱與側欄一致，同一個目的地不出現兩種叫法。
  const actions: DashboardAction[] = [];
  if (canAny("announcement:create", "email:*")) {
    actions.push({ href: "/publications", label: "發布中心", icon: Megaphone });
  }
  if (can("shop:manage")) {
    actions.push({ href: "/shop/admin", label: "商品設定", icon: ShoppingCart });
  }
  if (isAdmin || can("admin:users")) {
    actions.push({ href: "/admin/people", label: "人員與組織", icon: Users });
    actions.push({ href: "/admin", label: "系統總覽", icon: Settings });
  }
  if (isAdmin || can("admin:all")) {
    actions.push({ href: "/admin/system?tab=modules", label: "模組維護", icon: Wrench });
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
        style={{ borderColor: sev.color }}
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
      <span className="dashboard-action-label min-w-0">{action.label}</span>
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
