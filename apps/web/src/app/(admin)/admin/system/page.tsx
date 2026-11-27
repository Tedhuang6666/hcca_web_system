import { redirect } from "next/navigation";

import SystemOperationsWorkspace from "@/components/admin/system/SystemOperationsWorkspace";

export default async function SystemOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // 績效統計已移到獨立頁面，舊書籤直接轉過去。
  if ((await searchParams).tab === "performance") redirect("/analytics");
  return <SystemOperationsWorkspace />;
}
