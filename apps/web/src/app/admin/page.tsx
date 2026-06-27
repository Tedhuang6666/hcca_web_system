"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  BookUser,
  ClipboardList,
  Database,
  Puzzle,
  Settings,
  Shield,
  Users,
  WrenchIcon,
} from "lucide-react";
import { adminApi, auditLogsApi, systemApi, type ModuleStatus } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import type { AuditLogOut } from "@/lib/types";

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
        <div className="flex items-center gap-1.5 text-xs" style={{ color: warn && value ? "var(--error)" : "var(--text-muted)" }}>
          {icon}
          <span>{label}</span>
        </div>
        <p
          className="text-2xl font-semibold"
          style={{ color: warn && value ? "var(--error)" : "var(--text-primary)" }}
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
  meeting: "會議",
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

/* ── 快速操作定義 ─────────────────────────────────────────────────────────── */

const QUICK_ACTIONS = [
  { href: "/admin/people",       icon: Users,      label: "人員管理",   desc: "新增、搜尋與管理人員身分" },
  { href: "/admin/permissions",  icon: BookUser,   label: "權限管理",   desc: "組織職位與使用者權限指派" },
  { href: "/admin/classes",      icon: Users,      label: "班級管理",   desc: "班級名冊、幹部與學年度設定" },
  { href: "/admin/system",       icon: Shield,     label: "系統防護",   desc: "維護模式、限流與封鎖規則" },
  { href: "/admin/settings",     icon: Settings,   label: "系統設定",   desc: "全站設定與功能參數調整" },
  { href: "/admin/modules",      icon: Puzzle,     label: "模組維護",   desc: "查看各模組狀態、手動恢復" },
  { href: "/audit-logs",         icon: ClipboardList, label: "稽核日誌", desc: "追蹤所有操作紀錄" },
  { href: "/admin/diagnostics",  icon: Database,   label: "系統診斷",   desc: "資料庫、Redis 與 Celery 健康度" },
];

/* ── 主頁面 ──────────────────────────────────────────────────────────────── */

export default function AdminDashboardPage() {
  const { isAdmin, can } = usePermissions();

  const [userCount, setUserCount] = useState<number | null>(null);
  const [downModules, setDownModules] = useState<number | null>(null);
  const [positionCount, setPositionCount] = useState<number | null>(null);
  const [recentLogs, setRecentLogs] = useState<AuditLogOut[]>([]);
  const [maintenance, setMaintenance] = useState<{ enabled: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin && !can("admin:users")) return;
    Promise.allSettled([
      adminApi.listUsers({ active_only: true }),
      systemApi.listModules(),
      adminApi.listPositions(),
      auditLogsApi.list({ limit: 6 }),
      systemApi.status(),
    ]).then(([users, modules, positions, logs, status]) => {
      if (users.status === "fulfilled") setUserCount(users.value.length);
      if (modules.status === "fulfilled") {
        setDownModules((modules.value as ModuleStatus[]).filter((m) => !m.on).length);
      }
      if (positions.status === "fulfilled") setPositionCount(positions.value.length);
      if (logs.status === "fulfilled") setRecentLogs(logs.value as AuditLogOut[]);
      if (status.status === "fulfilled") setMaintenance(status.value.maintenance);
      setLoading(false);
    });
  }, [isAdmin, can]);

  if (!isAdmin && !can("admin:users")) {
    return (
      <div className="p-6 text-center" style={{ color: "var(--text-muted)" }}>
        您沒有存取管理後台的權限。
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
      <div>
        <p className="text-xs font-semibold tracking-widest uppercase mb-1" style={{ color: "var(--primary-text)" }}>
          管理後台
        </p>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
          系統總覽
        </h1>
      </div>

      {/* 快速統計 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          href="/admin/people"
          icon={<Users size={13} />}
          label="活躍人員"
          value={loading ? null : userCount}
        />
        <StatCard
          href="/admin/modules"
          icon={<Puzzle size={13} />}
          label="異常模組"
          value={loading ? null : downModules}
          warn
        />
        <StatCard
          href="/admin/permissions"
          icon={<BookUser size={13} />}
          label="組織職位"
          value={loading ? null : positionCount}
        />
        <StatCard
          href="/audit-logs"
          icon={<ClipboardList size={13} />}
          label="最新紀錄"
          value={loading ? null : recentLogs.length}
        />
      </div>

      {/* 快速操作 */}
      <div>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
          快速操作
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.href} href={action.href} style={{ textDecoration: "none" }}>
                <Panel className="p-3.5 flex flex-col gap-2 transition-colors hover:bg-[var(--bg-hover)] h-full">
                  <div
                    className="w-7 h-7 rounded flex items-center justify-center"
                    style={{ background: "var(--primary-dim)", color: "var(--primary-text)" }}
                  >
                    <Icon size={15} />
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {action.label}
                    </p>
                    <p className="text-[11px] mt-0.5 leading-snug" style={{ color: "var(--text-muted)" }}>
                      {action.desc}
                    </p>
                  </div>
                </Panel>
              </Link>
            );
          })}
        </div>
      </div>

      {/* 最近稽核紀錄 */}
      {recentLogs.length > 0 && (
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
                  className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-semibold"
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
