import type { DashboardCompositeResponse } from "@/lib/api/dashboard";
import { privateServerData, serverRequest } from "@/lib/server/request";
import { getServerSession } from "@/lib/server/session";

import DashboardPageClient, { type DashboardPageInitialData } from "./DashboardPageClient";

async function fetchOptional<T>(path: string): Promise<T | null> {
  try {
    return await serverRequest<T>(path, privateServerData);
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
    `/dashboard/composite?include_matters=${canViewGovernanceWork}`,
  );
  const initialData: DashboardPageInitialData = {
    userName: session.display_name,
    dashboard: composite?.dashboard ?? null,
    tasks: composite?.tasks ?? null,
    matters: composite?.matters ?? null,
    announcements: composite?.announcements ?? null,
  };

  return <DashboardPageClient initialData={initialData} />;
}
