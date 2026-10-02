"use client";

import type { ComponentType } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  BarChart3,
  Boxes,
  Database,
  LockKeyhole,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { usePermissions } from "@/hooks/usePermissions";

export type SystemOperationsTabId =
  | "defense"
  | "diagnostics"
  | "observability"
  | "modules"
  | "performance";

type SystemOperationsTab = {
  id: SystemOperationsTabId;
  label: string;
  description: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

const TABS: SystemOperationsTab[] = [
  {
    id: "defense",
    label: "系統防護",
    description: "維護、限流與存取規則",
    icon: ShieldCheck,
    adminOnly: true,
  },
  {
    id: "diagnostics",
    label: "系統診斷",
    description: "服務健康與版本狀態",
    icon: Database,
    adminOnly: true,
  },
  {
    id: "observability",
    label: "效能觀測",
    description: "錯誤、使用者體驗與慢查詢",
    icon: Activity,
    adminOnly: true,
  },
  {
    id: "modules",
    label: "模組維護",
    description: "模組可用性與恢復操作",
    icon: Boxes,
    adminOnly: true,
  },
  {
    id: "performance",
    label: "績效管理",
    description: "治理成效、公文效率與參與度",
    icon: BarChart3,
  },
];

function WorkspaceLoading() {
  return (
    <div className="space-y-4" role="status" aria-label="正在載入系統營運資料">
      <span className="sr-only">正在載入系統營運資料</span>
      <div className="h-28 animate-pulse rounded-md bg-[var(--bg-surface)]" />
      <div className="h-64 animate-pulse rounded-md bg-[var(--bg-surface)]" />
    </div>
  );
}

const SystemDefensePanel = dynamic(() => import("./SystemDefensePanel"), {
  loading: WorkspaceLoading,
});
const SystemDiagnosticsPanel = dynamic(() => import("./SystemDiagnosticsPanel"), {
  loading: WorkspaceLoading,
});
const SystemObservabilityPanel = dynamic(() => import("./SystemObservabilityPanel"), {
  loading: WorkspaceLoading,
});
const ModuleMaintenancePanel = dynamic(() => import("./ModuleMaintenancePanel"), {
  loading: WorkspaceLoading,
});
const PerformanceManagementPanel = dynamic(() => import("./PerformanceManagementPanel"), {
  loading: WorkspaceLoading,
});

const PANELS: Record<SystemOperationsTabId, ComponentType> = {
  defense: SystemDefensePanel,
  diagnostics: SystemDiagnosticsPanel,
  observability: SystemObservabilityPanel,
  modules: ModuleMaintenancePanel,
  performance: PerformanceManagementPanel,
};

function parseTab(value: string | null): SystemOperationsTabId | null {
  return TABS.some((tab) => tab.id === value) ? value as SystemOperationsTabId : null;
}

export default function SystemOperationsWorkspace({
  defaultTab = "defense",
}: {
  defaultTab?: SystemOperationsTabId;
}) {
  const searchParams = useSearchParams();
  const { can, isAdmin, isReady } = usePermissions();
  const visibleTabs = TABS.filter((tab) => !tab.adminOnly || isAdmin)
    .filter((tab) => tab.adminOnly || can("analytics:view"));
  const requestedTab = parseTab(searchParams.get("tab")) ?? defaultTab;
  const activeTab = visibleTabs.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : visibleTabs[0]?.id;
  const isPerformanceOnly = !isAdmin;

  if (!isReady) {
    return (
      <main className="mx-auto max-w-7xl p-4 md:p-6">
        <WorkspaceLoading />
      </main>
    );
  }

  if (!activeTab) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section className="card p-8 text-center">
          <LockKeyhole className="mx-auto mb-3 text-[var(--danger)]" size={32} aria-hidden />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">無法查看系統營運</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            需要超級管理員或 analytics:view 權限才能使用這個工作區。
          </p>
        </section>
      </main>
    );
  }

  const ActivePanel = PANELS[activeTab];

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-6">
      <header className="border-b pb-4" style={{ borderColor: "var(--border)" }}>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          {isPerformanceOnly ? "績效管理" : "系統營運中心"}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--text-secondary)]">
          {isPerformanceOnly
            ? "掌握治理成效、公文效率與參與度。"
            : "在同一個工作區掌握平台防護、服務健康、效能訊號、模組狀態與治理成效。"}
        </p>
        <nav className="mt-4 flex gap-1 overflow-x-auto" aria-label="系統營運分頁">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const active = tab.id === activeTab;
            const href = `/admin/system?tab=${tab.id}`;
            return (
              <Link
                key={tab.id}
                href={href}
                aria-current={active ? "page" : undefined}
                title={tab.description}
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
      </header>
      <section className="pt-6" aria-label={TABS.find((tab) => tab.id === activeTab)?.label}>
        <ActivePanel />
      </section>
    </main>
  );
}
