"use client";

import Link from "next/link";
import {
  Activity,
  BarChart3,
  Boxes,
  Database,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { usePermissions } from "@/hooks/usePermissions";

export type SystemAdminTabId =
  | "defense"
  | "diagnostics"
  | "observability"
  | "modules"
  | "performance";

type SystemAdminTab = {
  id: SystemAdminTabId;
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

const SYSTEM_ADMIN_TABS: SystemAdminTab[] = [
  { id: "defense", href: "/admin/system", label: "系統防護", icon: ShieldCheck, adminOnly: true },
  { id: "diagnostics", href: "/admin/diagnostics", label: "系統診斷", icon: Database, adminOnly: true },
  { id: "observability", href: "/admin/system/observability", label: "效能觀測", icon: Activity, adminOnly: true },
  { id: "modules", href: "/admin/modules", label: "模組維護", icon: Boxes, adminOnly: true },
  { id: "performance", href: "/analytics", label: "績效管理", icon: BarChart3 },
];

export default function SystemAdminTabs({ activeTab }: { activeTab: SystemAdminTabId }) {
  const { can, isAdmin } = usePermissions();
  const visibleTabs = SYSTEM_ADMIN_TABS.filter((tab) => {
    if (tab.adminOnly) return isAdmin;
    return isAdmin || can("analytics:view");
  });

  return (
    <div className="mb-5 border-b" style={{ borderColor: "var(--border)" }}>
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">系統營運</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          防護、健康、效能與治理成效集中在同一個工作區。
        </p>
      </div>
      <nav className="flex min-w-max gap-1 overflow-x-auto" aria-label="系統營運分頁">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              style={{
                borderColor: active ? "var(--primary)" : "transparent",
                color: active ? "var(--text-primary)" : "var(--text-muted)",
              }}>
              <Icon size={15} aria-hidden />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
