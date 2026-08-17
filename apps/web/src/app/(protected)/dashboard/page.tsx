import type { DashboardCompositeResponse } from "@/lib/api/dashboard";
import { privateServerData, serverRequest } from "@/lib/server/request";
import { getServerSession } from "@/lib/server/session";

import DashboardPageClient, { type DashboardPageInitialData } from "./DashboardPageClient";

const DASHBOARD_SERVER_FETCH_TIMEOUT_MS = 900;

function dashboardGreeting(): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone: "Asia/Taipei",
  }).format(new Date()));
  if (hour < 12) return "早安";
  if (hour < 18) return "午安";
  return "晚安";
}

async function fetchOptional<T>(path: string): Promise<T | null> {
  try {
    return await serverRequest<T>(path, privateServerData, {
      signal: AbortSignal.timeout(DASHBOARD_SERVER_FETCH_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const session = await getServerSession();
  if (!session) return <DashboardPageClient initialData={null} />;

  const canViewGovernanceWork = session.is_superuser
    || session.permissions.some((permission) => [
      "governance:manage",
      "meeting:manage",
      "activity:manage",
      "document:admin",
    ].includes(permission));
  const composite = await fetchOptional<DashboardCompositeResponse>(
    `/dashboard/composite?include_tasks=false&include_matters=${canViewGovernanceWork}&compact_dashboard=true`,
  );
  const initialData: DashboardPageInitialData = {
    userName: session.display_name,
    greeting: dashboardGreeting(),
    dashboard: composite?.dashboard ?? null,
    dashboardIsCompact: Boolean(composite),
    tasks: composite?.tasks ?? null,
    matters: composite?.matters ?? null,
    announcements: composite?.announcements ?? null,
  };

  return <DashboardPageClient initialData={initialData} />;
}
