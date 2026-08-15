import type { TaskInboxResponse } from "@/lib/api/tasks";
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

  // 首屏僅等待「優先處理」所需的待辦。跨模組動態、公告與治理摘要都不是
  // 首屏關鍵資料，改由 Client 在畫面可互動後背景取得，避免最慢的聚合查詢
  // 延後整個 dashboard（也連帶延後側欄 hydration）。
  const tasks = await fetchOptional<TaskInboxResponse>("/tasks");
  const initialData: DashboardPageInitialData = {
    userName: session.display_name,
    tasks,
  };

  return <DashboardPageClient initialData={initialData} />;
}
