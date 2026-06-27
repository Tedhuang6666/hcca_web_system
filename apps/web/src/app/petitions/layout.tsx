"use client";

import ModuleBoundary from "@/components/ModuleBoundary";
import ModuleTabs, { type ModuleTab } from "@/components/layout/ModuleTabs";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { FilePlus2, Inbox, Settings } from "lucide-react";

export default function PetitionsLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, permissions } = usePermissions();
  const canManage = isAdmin || permissions.has("admin:all") || Array.from(permissions).some((p) => p.startsWith("petition:"));
  const tabs: ModuleTab[] = [
    { href: "/petitions", label: "案件查詢", icon: Inbox, end: true },
    { href: "/petitions/new", label: "我要陳情", icon: FilePlus2 },
    ...(canManage ? [{ href: "/petitions/manage", label: "管理", icon: Settings }] : []),
  ];

  return (
    <ModuleBoundary id="petitions" skeleton={<ListPageSkeleton />}>
      <ModuleTabs label="陳情分頁" tabs={tabs} />
      {children}
    </ModuleBoundary>
  );
}
