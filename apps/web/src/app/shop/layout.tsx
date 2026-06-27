"use client";

import ModuleBoundary from "@/components/ModuleBoundary";
import ModuleTabs, { type ModuleTab } from "@/components/layout/ModuleTabs";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { ClipboardList, PackageSearch, ShoppingCart, Store } from "lucide-react";

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  const { can, isAdmin, permissions } = usePermissions();
  const canManage = isAdmin || permissions.has("admin:all") || permissions.has("shop:manage");
  const canCollect = can("class:shop_collect");
  const tabs: ModuleTab[] = [
    { href: "/shop", label: "商品", icon: Store, end: true },
    { href: "/shop/cart", label: "購物車", icon: ShoppingCart },
    { href: "/shop/orders", label: "我的訂單", icon: ClipboardList },
    ...(canCollect ? [{ href: "/shop/class-orders", label: "班級訂單", icon: PackageSearch }] : []),
    ...(canManage ? [{ href: "/shop/admin", label: "管理", icon: PackageSearch }] : []),
  ];

  return (
    <ModuleBoundary id="shop" skeleton={<ListPageSkeleton />}>
      <ModuleTabs label="商品分頁" tabs={tabs} />
      {children}
    </ModuleBoundary>
  );
}
