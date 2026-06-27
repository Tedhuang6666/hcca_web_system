"use client";

import ModuleBoundary from "@/components/ModuleBoundary";
import ModuleTabs, { type ModuleTab } from "@/components/layout/ModuleTabs";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { MapPinned, Settings } from "lucide-react";

export default function PartnerMapLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, permissions } = usePermissions();
  const canManage = isAdmin || permissions.has("admin:all") || Array.from(permissions).some((p) => p.startsWith("partner_map:"));
  const tabs: ModuleTab[] = [
    { href: "/partner-map", label: "地圖", icon: MapPinned, end: true },
    ...(canManage ? [{ href: "/partner-map/admin", label: "管理", icon: Settings }] : []),
  ];

  return (
    <ModuleBoundary id="partnerMap" skeleton={<ListPageSkeleton />}>
      <ModuleTabs label="特約地圖分頁" tabs={tabs} />
      {children}
    </ModuleBoundary>
  );
}
