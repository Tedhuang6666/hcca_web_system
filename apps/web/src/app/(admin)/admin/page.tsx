"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BookUser, ChevronRight, Puzzle, Users } from "lucide-react";
import { adminApi, auditLogsApi, systemApi, type ModuleStatus } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import type { AuditLogOut } from "@/lib/types";
import { cacheGet, cacheHas, cacheSet } from "@/lib/api-cache";
import { ADMIN_CATALOG, isNavItemVisible } from "@/lib/navigation";
import { NAV_ID_TO_MODULE } from "@/lib/modules";
import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import NavIcon from "@/components/layout/NavIcon";

/* ── 小元件 ──────────────────────────────────────────────────────────────── */

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-md ${className}`} style={{ border: "1px solid var(--border)" }}>
      {children}
    </section>
  );
}

function StatCard({
  icon,
  label,
  value,
  warn,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  warn?: boolean;
  href: string;
}) {
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      <Panel className="p-4 flex flex-col gap-1 transition-colors hover:bg-[var(--bg-hover)]">
        <div className="flex items-center gap-1.5 text-xs" style={{ color: warn && value ? "var(--danger)" : "var(--text-muted)" }}>
          {icon}
          <span>{label}</span>
        </div>
        <p
          className="text-2xl font-semibold"
          style={{ color: warn && value ? "var(--danger)" : "var(--text-primary)" }}
        >
          {value === null ? "—" : value}
        </p>
      </Panel>
    </Link>
  );
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "剛剛";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

const ENTITY_LABELS: Record<string, string> = {
  document: "公文",
  user: "使用者",
  person: "人員",
  regulation: "法規",
  announcement: "公告",
  petition: "陳情",
  survey: "問卷",
  position: "職位",
  org: "組織",
  class: "班級",
  election: "選舉",
};

function entityLabel(type: string) {
  return ENTITY_LABELS[type] ?? type;
}

/* ── 主頁面 ──────────────────────────────────────────────────────────────── */

const ADMIN_CACHE_KEY = "admin/dashboard";

export default function AdminDashboardPage() {
  const { isAdmin, can, permissions, isReady } = usePermissions();
  const { isModuleClosed } = useModuleStatus();
  const canAccessAdmin = isAdmin || can("admin:users");
  const hasPrefix = (prefix: string) =>
    isAdmin || permissions.has("admin:all") || [...permissions].some((code) => code.startsWith(prefix));
  const visibility = {
    can,
    hasPrefix,
    isAdmin,
    isModuleClosed: (item: { id: string }) => isModuleClosed(NAV_ID_TO_MODULE[item.id] ?? null),
  };
  const toolSections = ADMIN_CATALOG
    .map((section) => ({ ...section, items: section.items.filter((item) => isNavItemVisible(item, visibility)) }))
    .filter((section) => section.items.length > 0);

  const [userCount, setUserCount] = useState<number | null>(() => cacheGet<number>(ADMIN_CACHE_KEY + "/userCount") ?? null);
  const [downModules, setDownModules] = useState<number | null>(() => cacheGet<number>(ADMIN_CACHE_KEY + "/downModules") ?? null);
  const [positionCount, setPositionCount] = useState<number | null>(() => cacheGet<number>(ADMIN_CACHE_KEY + "/positionCount") ?? null);
  const [recentLogs, setRecentLogs] = useState<AuditLogOut[]>(() => cacheGet<AuditLogOut[]>(ADMIN_CACHE_KEY + "/logs") ?? []);
  const [maintenance, setMaintenance] = useState<{ enabled: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(!cacheHas(ADMIN_CACHE_KEY + "/userCount"));

  useEffect(() => {
    if (!canAccessAdmin) return;
    Promise.allSettled([
      adminApi.dashboardStats(),
      systemApi.listModules(),
      auditLogsApi.list({ limit: 6 }),
      systemApi.status(),
    ]).then(([users, modules, logs, status]) => {
      if (users.status === "fulfilled") {
        setUserCount(users.value.active_user_count);
        cacheSet(ADMIN_CACHE_KEY + "/userCount", users.value.active_user_count);
      }
      if (modules.status === "fulfilled") {
        const count = (modules.value as ModuleStatus[]).filter((m) => !m.on).length;
        setDownModules(count);
        cacheSet(ADMIN_CACHE_KEY + "/downModules", count);
      }
      if (users.status === "fulfilled") {
        setPositionCount(users.value.position_count);
        cacheSet(ADMIN_CACHE_KEY + "/positionCount", users.value.position_count);
      }
      if (logs.status === "fulfilled") {
        setRecentLogs(logs.value as AuditLogOut[]);
        cacheSet(ADMIN_CACHE_KEY + "/logs", logs.value);
      }
      if (status.status === "fulfilled") setMaintenance(status.value.maintenance);
      setLoading(false);
    });
  }, [canAccessAdmin, can]);

  if (!isReady) return null;

  if (toolSections.length === 0) {
    return (
      <div className="p-6 text-center" style={{ color: "var(--text-muted)" }}>
        目前沒有可使用的管理工具。
      </div>
    );
  }

  return (
    <div className="p-5 md:p-6 max-w-5xl mx-auto space-y-6">

      {/* 維護模式警示 */}
      {maintenance?.enabled && (
        <div
          className="flex items-start gap-3 rounded-md px-4 py-3 text-sm"
          style={{
            background: "var(--warning-dim)",
            border: "1px solid var(--warning-border)",
            color: "var(--warning)",
          }}
        >
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <span className="font-semibold">系統目前處於維護模式</span>
            {maintenance.message && (
              <span className="ml-1">— {maintenance.message}</span>
            )}
          </div>
          <Link
            href="/admin/system"
            className="flex-shrink-0 text-xs underline underline-offset-2"
            style={{ color: "var(--warning)" }}
          >
            前往設定
          </Link>
        </div>
      )}

      {/* 標題 */}
      <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        管理中心
      </h1>

      {canAccessAdmin && <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard
          href="/admin/people"
          icon={<Users size={13} />}
          label="活躍人員"
          value={loading ? null : userCount}
        />
        <StatCard
          href="/admin/modules"
          icon={<Puzzle size={13} />}
          label="關閉模組"
          value={loading ? null : downModules}
          warn
        />
        <StatCard
          href="/admin/people?section=organization"
          icon={<BookUser size={13} />}
          label="組織職位"
          value={loading ? null : positionCount}
        />
      </div>}

      {toolSections.map((section) => (
        <section key={section.id} aria-labelledby={`${section.id}-heading`}>
          <h2 id={`${section.id}-heading`} className="mb-2 text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
            {section.heading}
          </h2>
          <ul className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item) => (
              <li key={item.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <Link
                  href={item.href}
                  className="flex min-h-12 items-center gap-3 rounded-md px-2 text-sm font-medium transition-colors hover:bg-[var(--bg-hover)]"
                  style={{ color: "var(--text-primary)", textDecoration: "none" }}
                >
                  <span aria-hidden style={{ color: "var(--text-muted)" }}><NavIcon iconKey={item.iconKey} size={16} /></span>
                  <span className="min-w-0 flex-1">{item.label}</span>
                  <ChevronRight size={15} aria-hidden style={{ color: "var(--text-disabled)" }} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* 最近稽核紀錄 */}
      {canAccessAdmin && recentLogs.length > 0 && (
        <Panel>
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              最近操作紀錄
            </h2>
            <Link
              href="/audit-logs"
              className="text-xs"
              style={{ color: "var(--primary-text)", textDecoration: "none" }}
            >
              查看全部 →
            </Link>
          </div>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {recentLogs.map((log) => (
              <li key={log.id} className="flex items-start gap-3 px-4 py-2.5">
                <div
                  className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold"
                  style={{
                    background: "var(--primary-dim)",
                    color: "var(--primary-text)",
                  }}
                >
                  {(log.actor_email ?? "S").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
                    <span className="font-medium">{log.actor_email ?? "系統"}</span>
                    {" "}
                    <span style={{ color: "var(--text-muted)" }}>
                      {log.summary ?? `${log.action} ${entityLabel(log.entity_type)}`}
                    </span>
                  </p>
                </div>
                <span className="text-xs flex-shrink-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {timeAgo(log.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

    </div>
  );
}
