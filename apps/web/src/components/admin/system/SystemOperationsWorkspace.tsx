"use client";

import type { ComponentType } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  Ban,
  Boxes,
  Bug,
  Database,
  LockKeyhole,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

import { usePermissions } from "@/hooks/usePermissions";

export type SystemOperationsTabId =
  | "defense"
  | "blocking"
  | "diagnostics"
  | "observability"
  | "errors"
  | "real-users"
  | "modules";

type SystemOperationsTab = {
  id: SystemOperationsTabId;
  label: string;
  description: string;
  icon: LucideIcon;
};

const TABS: SystemOperationsTab[] = [
  {
    id: "defense",
    label: "系統防護",
    description: "維護模式、全域限流與緊急封鎖",
    icon: ShieldCheck,
  },
  {
    id: "blocking",
    label: "封鎖與規則",
    description: "封鎖使用者與長期防禦規則",
    icon: Ban,
  },
  {
    id: "diagnostics",
    label: "系統診斷",
    description: "服務健康與版本狀態",
    icon: Database,
  },
  {
    id: "observability",
    label: "頁面效能",
    description: "各頁 Lighthouse／PSI 分數與部署版本",
    icon: Activity,
  },
  {
    id: "errors",
    label: "錯誤與慢查詢",
    description: "事故、例外與慢交易",
    icon: Bug,
  },
  {
    id: "real-users",
    label: "真實使用者",
    description: "使用者實際體驗與路由效能",
    icon: Users,
  },
  {
    id: "modules",
    label: "維護與復原",
    description: "模組狀態、快取、服務重啟與失敗任務",
    icon: Boxes,
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
const UserBlockingPanel = dynamic(() => import("./UserBlockingPanel"), {
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

const PANELS: Record<SystemOperationsTabId, ComponentType> = {
  defense: SystemDefensePanel,
  blocking: UserBlockingPanel,
  diagnostics: SystemDiagnosticsPanel,
  observability: SystemObservabilityPanel,
  errors: () => <SystemObservabilityPanel view="errors" />,
  "real-users": () => <SystemObservabilityPanel view="real-users" />,
  modules: ModuleMaintenancePanel,
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
  const { isAdmin, isReady } = usePermissions();
  const visibleTabs = isAdmin ? TABS : [];
  const requestedTab = parseTab(searchParams.get("tab")) ?? defaultTab;
  const activeTab = visibleTabs.some((tab) => tab.id === requestedTab)
    ? requestedTab
    : visibleTabs[0]?.id;

  if (!isReady) {
    return (
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <WorkspaceLoading />
      </div>
    );
  }

  if (!activeTab) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <section className="card p-8 text-center">
          <LockKeyhole className="mx-auto mb-3 text-[var(--danger)]" size={32} aria-hidden />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">無法查看系統營運</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            請洽系統管理員開啟權限。
          </p>
        </section>
      </div>
    );
  }

  const ActivePanel = PANELS[activeTab];

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <header className="border-b pb-4" style={{ borderColor: "var(--border)" }}>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          系統營運中心
        </h1>
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
    </div>
  );
}
