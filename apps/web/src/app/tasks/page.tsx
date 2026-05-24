"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  FileText, Landmark, Scale, MessageSquare, CheckSquare, ShoppingCart,
  Utensils, Megaphone, Inbox, Loader2, AlertCircle, Clock, ChevronRight,
} from "lucide-react";
import { tasksApi, type TaskItem, type TaskInboxResponse, type TaskModule } from "@/lib/api";

type IconProps = { size: number; "aria-hidden": boolean };
function FallbackModuleIcon(p: IconProps) { return <FileText {...p} />; }

const MODULE_ICONS: Record<TaskModule, React.ComponentType<IconProps>> = {
  document: (p) => <FileText {...p} />,
  meeting: (p) => <Landmark {...p} />,
  regulation: (p) => <Scale {...p} />,
  petition: (p) => <MessageSquare {...p} />,
  survey: (p) => <CheckSquare {...p} />,
  shop: (p) => <ShoppingCart {...p} />,
  meal: (p) => <Utensils {...p} />,
  announcement: (p) => <Megaphone {...p} />,
};

const MODULE_LABEL: Record<TaskModule, string> = {
  document: "公文",
  meeting: "議事",
  regulation: "法規",
  petition: "陳情",
  survey: "問卷",
  shop: "校商",
  meal: "學餐",
  announcement: "公告",
};

const SEVERITY_STYLES: Record<string, { color: string; bg: string; border: string; label: string }> = {
  info:     { color: "var(--primary)", bg: "var(--primary-dim)", border: "var(--info-border)",    label: "一般" },
  warning:  { color: "var(--warning)", bg: "var(--warning-dim)", border: "var(--warning-border)", label: "提醒" },
  critical: { color: "var(--danger)",  bg: "var(--danger-dim)",  border: "var(--danger-border)",  label: "緊急" },
};

function formatDueAt(s?: string | null) {
  if (!s) return "";
  const d = new Date(s);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffH = Math.round(diffMs / (1000 * 60 * 60));
  if (diffMs < 0) {
    const overdueH = Math.abs(diffH);
    return overdueH < 24 ? `已過 ${overdueH} 小時` : `已過 ${Math.round(overdueH / 24)} 天`;
  }
  if (diffH < 24) return `${diffH} 小時內`;
  return `${Math.round(diffH / 24)} 天後`;
}

export default function TasksPage() {
  const [data, setData] = useState<TaskInboxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TaskModule | "all">("all");

  useEffect(() => {
    let mounted = true;
    tasksApi.list()
      .then((res) => { if (mounted) setData(res); })
      .catch((e) => {
        toast.error("無法載入待辦中心");
        console.error(e);
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const filtered = useMemo<TaskItem[]>(() => {
    if (!data) return [];
    if (tab === "all") return data.items;
    return data.items.filter((t) => t.module === tab);
  }, [data, tab]);

  const moduleTabs: Array<TaskModule | "all"> = useMemo(() => {
    const tabs: Array<TaskModule | "all"> = ["all"];
    if (!data) return tabs;
    const present = Object.keys(data.by_module).sort() as TaskModule[];
    return [...tabs, ...present];
  }, [data]);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"
            style={{ color: "var(--text-primary)" }}>
            <Inbox size={20} aria-hidden={true} style={{ color: "var(--primary)" }} />
            我的待辦
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            跨模組統一收集需要您動作的事項
          </p>
        </div>
        {data && (
          <span className="text-3xl font-bold leading-none"
            style={{ color: "var(--text-primary)" }}>
            {data.total}
          </span>
        )}
      </header>

      {/* Tabs */}
      <div className="flex gap-0.5 p-1 rounded-xl overflow-x-auto"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        role="tablist" aria-label="待辦類別">
        {moduleTabs.map((m) => {
          const count = m === "all" ? (data?.total ?? 0) : (data?.by_module[m] ?? 0);
          const active = tab === m;
          return (
            <button
              key={m}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(m)}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
              style={{
                background: active ? "var(--primary-dim)" : "transparent",
                color: active ? "var(--primary)" : "var(--text-muted)",
                border: active ? "1px solid var(--info-border)" : "1px solid transparent",
              }}>
              <span>{m === "all" ? "全部" : MODULE_LABEL[m as TaskModule]}</span>
              <span className="opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin" aria-hidden={true}
            style={{ color: "var(--text-muted)" }} />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-2">
          {filtered.map((t) => <TaskRow key={t.id} t={t} />)}
        </ul>
      )}
    </div>
  );
}

function TaskRow({ t }: { t: TaskItem }) {
  const sev = SEVERITY_STYLES[t.severity] ?? SEVERITY_STYLES.info;
  const Icon = MODULE_ICONS[t.module] ?? FallbackModuleIcon;
  const due = formatDueAt(t.due_at);

  return (
    <li>
      <Link
        href={t.href}
        className="flex items-center gap-3 p-4 rounded-lg transition-colors"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          textDecoration: "none",
          borderLeftWidth: "3px",
          borderLeftColor: sev.color,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-surface)")}>
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: sev.bg, color: sev.color, border: `1px solid ${sev.border}` }}
          aria-hidden="true">
          <Icon size={15} aria-hidden={true} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
            {t.title}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ color: sev.color, background: sev.bg, border: `1px solid ${sev.border}` }}>
              {MODULE_LABEL[t.module] ?? t.module}
            </span>
            {t.subtitle && (
              <span className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                {t.subtitle}
              </span>
            )}
            {due && (
              <span className="text-xs flex items-center gap-1 ml-auto"
                style={{ color: t.severity === "critical" ? sev.color : "var(--text-muted)" }}>
                {t.severity === "critical" ? (
                  <AlertCircle size={11} aria-hidden={true} />
                ) : (
                  <Clock size={11} aria-hidden={true} />
                )}
                {due}
              </span>
            )}
          </div>
        </div>
        <ChevronRight size={16} aria-hidden={true} style={{ color: "var(--text-disabled)" }} />
      </Link>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16 px-4"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
      }}>
      <Inbox size={36} aria-hidden={true}
        style={{ color: "var(--text-disabled)", display: "inline-block", marginBottom: 10 }} />
      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
        目前沒有待辦事項
      </p>
      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
        所有需要您動作的項目都會集中在這裡
      </p>
    </div>
  );
}
