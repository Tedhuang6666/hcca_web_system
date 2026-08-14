"use client";

import ModuleBoundary from "@/components/ModuleBoundary";
import ModuleTabs, { type ModuleTab } from "@/components/layout/ModuleTabs";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { ClipboardList, Store, Truck } from "lucide-react";

export default function MealLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, permissions } = usePermissions();
  const canManage = isAdmin || permissions.has("admin:all") || permissions.has("meal:manage");
  const tabs: ModuleTab[] = [
    { href: "/meal", label: "訂餐", icon: Store, end: true },
    { href: "/meal/orders", label: "我的訂單", icon: ClipboardList },
    ...(canManage ? [{ href: "/meal/vendor", label: "餐商管理", icon: Truck }] : []),
  ];

  return (
    <ModuleBoundary id="meal" skeleton={<ListPageSkeleton />}>
      <ModuleTabs label="學餐分頁" tabs={tabs} />
      {children}
    </ModuleBoundary>
  );
}
