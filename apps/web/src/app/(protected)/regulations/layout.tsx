"use client";

import ModuleBoundary from "@/components/ModuleBoundary";
import ModuleTabs, { type ModuleTab } from "@/components/layout/ModuleTabs";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { Archive, BookOpen, FilePlus2, Hourglass } from "lucide-react";

export default function RegulationsLayout({ children }: { children: React.ReactNode }) {
  const { can } = usePermissions();
  const canCreate = can("regulation:create");
  const canPublish = can("regulation:publish");
  const tabs: ModuleTab[] = [
    { href: "/regulations", label: "現行法規", icon: BookOpen, end: true },
    ...(canCreate ? [{ href: "/regulations/new", label: "新增", icon: FilePlus2 }] : []),
    ...(canPublish ? [{ href: "/regulations/pending", label: "待發布", icon: Hourglass }] : []),
    { href: "/regulations/archived", label: "歷史封存", icon: Archive },
  ];

  return (
    <ModuleBoundary id="regulations" skeleton={<ListPageSkeleton />}>
      <ModuleTabs label="法規分頁" tabs={tabs} />
      {children}
    </ModuleBoundary>
  );
}
