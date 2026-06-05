"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  FileText, ListChecks, Landmark, Scale, Megaphone, MessageSquare,
  CheckSquare, ChevronRight, Plus, Loader2, Sparkles, Clock,
  FolderKanban, GitBranch, ScrollText, Workflow,
} from "lucide-react";
import {
  dashboardApi,
  governanceApi,
  type DashboardResponse,
  type DashboardWidget,
} from "@/lib/api";
import type { GovernanceDashboardOut } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";
import { useRecentItems } from "@/hooks/useRecentItems";
import OnboardingHint from "@/components/ui/OnboardingHint";

type IconProps = { size: number; "aria-hidden": boolean; style?: React.CSSProperties };
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
  officer: "幹部視角",
  leader: "領導視角",
};

function formatDate(s?: string | null) {
  if (!s) return "";
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function WidgetCard({ w }: { w: DashboardWidget }) {
  const Icon = WIDGET_ICONS[w.key] ?? FallbackWidgetIcon;
  const sev = SEVERITY_STYLES[w.severity] ?? SEVERITY_STYLES.info;

  return (
    <section
      aria-labelledby={`widget-${w.key}`}
      className="card overflow-hidden flex flex-col"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-sm)",
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
                  className="flex items-center gap-3 px-5 py-3 transition-colors"
                  style={{ textDecoration: "none" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
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
          className="px-5 py-2.5 text-xs font-medium flex items-center justify-end gap-1 transition-colors"
          style={{
            color: "var(--primary)",
            borderTop: "1px solid var(--border)",
            textDecoration: "none",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
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
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [governance, setGovernance] = useState<GovernanceDashboardOut | null>(null);
  const [loading, setLoading] = useState(true);
  const { can } = usePermissions();
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
    dashboardApi.get()
      .then((res) => setData(res))
      .catch((e) => {
        toast.error("無法載入儀表板");
        console.error(e);
      })
      .finally(() => setLoading(false));
    governanceApi.dashboard()
      .then((res) => setGovernance(res))
      .catch((e) => {
        console.error(e);
      });
  }, []);

  const widgets = data?.widgets ?? [];
  const layoutHint = data?.layout_hint ?? "student";
  const hasAny = widgets.length > 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* 一次性引導：首次進站時提示 */}
      <OnboardingHint id="hint.dashboard.first-visit">
        歡迎使用平台首頁！下面的卡片會依您的角色顯示最相關的待辦與最新消息，
        點任一卡片可以直接開始。
      </OnboardingHint>

      {/* 頁首 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {greeting}，{userName || "使用者"}
            </h1>
            {data && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1"
                style={{
                  background: "var(--primary-dim)",
                  color: "var(--primary)",
                  border: "1px solid var(--info-border)",
                }}>
                <Sparkles size={10} aria-hidden={true} />
                {HINT_LABEL[layoutHint]}
              </span>
            )}
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {hasAny
              ? "以下是依您的角色聚合的待辦與最新項目"
              : "目前沒有等您處理的事項"}
          </p>
        </div>
        {can("document:draft") && (
          <Link href="/documents/new" className="btn btn-primary self-start sm:self-auto">
            <Plus size={13} aria-hidden={true} />
            新增公文
          </Link>
        )}
      </div>

      <GovernanceHubPanel data={governance} />

      {/* 最近開啟：個人化捷徑，少翻選單 */}
      {recents.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1">
          <span className="flex items-center gap-1 text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
            <Clock size={12} aria-hidden={true} />
            最近開啟
          </span>
          {recents.map((item) => (
            <Link
              key={`${item.kind}-${item.id}`}
              href={item.href}
              className="flex-shrink-0 max-w-[180px] truncate px-3 py-1.5 rounded-full text-xs font-medium transition-opacity hover:opacity-80"
              style={{
                background: "var(--bg-surface)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
                textDecoration: "none",
              }}
              title={item.title}>
              {item.title}
            </Link>
          ))}
        </div>
      )}

      {/* Widget Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : hasAny ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {widgets.map((w) => (
            <WidgetCard key={w.key} w={w} />
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

function GovernanceHubPanel({ data }: { data: GovernanceDashboardOut | null }) {
  const stats = data?.stats;
  const matters = data?.matters ?? [];
  return (
    <section
      className="rounded-lg overflow-hidden"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-sm)",
      }}
      aria-labelledby="governance-hub-title"
    >
      <div
        className="grid gap-0 lg:grid-cols-[1.2fr_1fr]"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="p-5">
          <div className="flex items-center gap-2">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{
                background: "var(--primary-dim)",
                color: "var(--primary)",
                border: "1px solid var(--info-border)",
              }}
              aria-hidden="true"
            >
              <FolderKanban size={17} aria-hidden={true} />
            </div>
            <div>
              <h2 id="governance-hub-title" className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                治理中樞 2.0
              </h2>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                從事情進入，追蹤案件、決議、企劃書、任務與歸檔脈絡
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <GovernanceMetric icon={FolderKanban} label="進行中事情" value={stats?.active_matters ?? 0} />
            <GovernanceMetric icon={GitBranch} label="開放案件" value={stats?.open_cases ?? 0} />
            <GovernanceMetric icon={ScrollText} label="待執行決議" value={stats?.pending_decisions ?? 0} />
            <GovernanceMetric icon={Workflow} label="送審企劃" value={stats?.plans_in_review ?? 0} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/governance" className="btn btn-primary">
              進入治理中樞
              <ChevronRight size={13} aria-hidden={true} />
            </Link>
            <Link href="/governance" className="btn btn-secondary">
              建立事情
              <Plus size={13} aria-hidden={true} />
            </Link>
          </div>
        </div>
        <div className="p-5" style={{ background: "var(--bg-hover)" }}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              最近治理事項
            </h3>
            <Link href="/governance" className="text-xs font-medium" style={{ color: "var(--primary)", textDecoration: "none" }}>
              全部
            </Link>
          </div>
          <div className="space-y-2">
            {matters.slice(0, 4).map((matter) => (
              <Link
                key={matter.id}
                href={`/governance/${matter.id}`}
                className="flex items-center justify-between gap-3 rounded-md px-3 py-2 transition-colors"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  textDecoration: "none",
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {matter.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs" style={{ color: "var(--text-muted)" }}>
                    {matter.case_count} 案件 · {matter.open_task_count} 任務 · {matter.progress_percent}%
                  </span>
                </span>
                <ChevronRight size={14} aria-hidden={true} style={{ color: "var(--text-disabled)" }} />
              </Link>
            ))}
            {matters.length === 0 && (
              <div
                className="rounded-md px-3 py-6 text-center text-xs"
                style={{ background: "var(--bg-surface)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
              >
                尚未建立事情。從治理中樞建立第一個 Matter。
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function GovernanceMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<IconProps>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md p-3" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{label}</span>
        <Icon size={13} aria-hidden={true} style={{ color: "var(--primary)" }} />
      </div>
      <p className="mt-2 text-xl font-semibold leading-none" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}

function EmptyState() {
  const links = [
    { href: "/announcements", label: "看公告" },
    { href: "/regulations", label: "查法規" },
    { href: "/shop", label: "校商訂購" },
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
