import type { DashboardResponse } from "@/lib/api/dashboard";
import type { TaskInboxResponse } from "@/lib/api/tasks";
import { privateServerData, serverRequest } from "@/lib/server/request";
import { getServerSession } from "@/lib/server/session";
import type { AnnouncementListItem, MatterListItem } from "@/lib/types";

import DashboardPageClient, { type DashboardPageInitialData } from "./DashboardPageClient";

function canViewGovernanceWork(permissions: readonly string[], isAdmin: boolean): boolean {
  if (isAdmin || permissions.includes("admin:all")) return true;
  return ["governance:manage", "meeting:manage", "activity:manage", "document:admin"]
    .some((permission) => permissions.includes(permission));
}

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

  const governanceEnabled = canViewGovernanceWork(
    session.permissions,
    Boolean(session.is_superuser || session.is_owner),
  );
  const [dashboard, tasks, matters, announcements] = await Promise.all([
    fetchOptional<DashboardResponse>("/dashboard"),
    fetchOptional<TaskInboxResponse>("/tasks"),
    governanceEnabled
      ? fetchOptional<MatterListItem[]>("/governance/matters?status=active&limit=6")
      : Promise.resolve([]),
    fetchOptional<AnnouncementListItem[]>("/announcements?limit=3"),
  ]);
  const initialData: DashboardPageInitialData = {
    userName: session.display_name,
    dashboard,
    tasks,
    matters: matters ?? [],
    announcements: announcements ?? [],
  };

  return <DashboardPageClient initialData={initialData} />;
}
