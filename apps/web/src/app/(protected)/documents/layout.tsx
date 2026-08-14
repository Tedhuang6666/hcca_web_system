"use client";

import ModuleBoundary from "@/components/ModuleBoundary";
import ModuleTabs, { type ModuleTab } from "@/components/layout/ModuleTabs";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { FilePlus2, FileText, UserCheck } from "lucide-react";

export default function DocumentsLayout({ children }: { children: React.ReactNode }) {
  const { can, isAdmin, permissions } = usePermissions();
  const canCreate = can("document:create") || can("document:draft");
  const canDelegate = isAdmin || permissions.has("admin:all") || permissions.has("document:admin");
  const tabs: ModuleTab[] = [
    { href: "/documents", label: "公文", icon: FileText, end: true },
    ...(canCreate ? [{ href: "/documents/new", label: "新增", icon: FilePlus2 }] : []),
    ...(canDelegate ? [{ href: "/documents/delegations", label: "代理設定", icon: UserCheck }] : []),
  ];

  return (
    <ModuleBoundary id="documents" skeleton={<ListPageSkeleton />}>
      <ModuleTabs label="公文分頁" tabs={tabs} />
      {children}
    </ModuleBoundary>
  );
}
