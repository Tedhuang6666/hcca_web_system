"use client";

import ModuleBoundary from "@/components/ModuleBoundary";
import ModuleTabs, { type ModuleTab } from "@/components/layout/ModuleTabs";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { List, MapPinned, Settings, Tags } from "lucide-react";

export default function RecommendedVendorsLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, permissions } = usePermissions();
  const canManage = isAdmin || permissions.has("admin:all") || permissions.has("recommended_vendor:manage");
  const tabs: ModuleTab[] = [
    { href: "/recommended-vendors", label: "清單", icon: List, end: true },
    { href: "/recommended-vendors?view=map", label: "地圖", icon: MapPinned },
    ...(canManage ? [{ href: "/recommended-vendors/admin", label: "管理", icon: Settings, end: true }] : []),
    ...(canManage ? [{ href: "/recommended-vendors/admin/categories", label: "分類", icon: Tags, end: true }] : []),
  ];

  return (
    <ModuleBoundary id="recommendedVendors" skeleton={<ListPageSkeleton />}>
      <ModuleTabs label="推薦商家分頁" tabs={tabs} />
      {children}
    </ModuleBoundary>
  );
}
