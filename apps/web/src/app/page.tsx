"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  FileText, ListChecks, Landmark, Scale, Megaphone, MessageSquare,
  CheckSquare, ChevronRight, Plus, Loader2, Sparkles,
} from "lucide-react";
import { dashboardApi, type DashboardResponse, type DashboardWidget } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";

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
    dashboardApi.get()
      .then((res) => setData(res))
      .catch((e) => {
        toast.error("無法載入儀表板");
        console.error(e);
      })
      .finally(() => setLoading(false));
  }, []);

  const widgets = data?.widgets ?? [];
  const layoutHint = data?.layout_hint ?? "student";
  const hasAny = widgets.length > 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6">

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
        {can("document:create") && (
          <Link href="/documents/new" className="btn btn-primary self-start sm:self-auto">
            <Plus size={13} aria-hidden={true} />
            新增公文
          </Link>
        )}
      </div>

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
