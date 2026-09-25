"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ModuleBoundary from "@/components/ModuleBoundary";
import ModuleTabs, { type ModuleTab } from "@/components/layout/ModuleTabs";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { BarChart2, ClipboardList, PackageSearch, ShoppingCart, Store } from "lucide-react";
import BrandEmblem from "@/components/brand/BrandEmblem";
import { BRANDING } from "@/lib/branding";

function PublicShopChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <header className="sticky top-0 z-30 border-b" style={{ background: "color-mix(in srgb, var(--bg-surface) 94%, transparent)", borderColor: "var(--border)", backdropFilter: "blur(14px)" }}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/shop" className="flex min-w-0 items-center gap-3" style={{ textDecoration: "none", color: "inherit" }}>
            <BrandEmblem size={34} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{BRANDING.orgShortName} 校商</span>
              <span className="block text-xs" style={{ color: "var(--text-muted)" }}>校園選物與活動票券</span>
            </span>
          </Link>
          <nav className="flex shrink-0 items-center gap-2" aria-label="校商導覽">
            <Link href="/shop/orders" className="hidden rounded-lg px-3 py-2 text-sm sm:inline-flex" style={{ color: "var(--text-secondary)" }}>
              我的訂單
            </Link>
            <Link href="/shop/cart" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: "var(--primary-dim)", color: "var(--primary-text)" }}>
              <ShoppingCart size={16} aria-hidden />
              購物車
            </Link>
            <Link href="/login?next=%2Fshop%2Fcart" className="hidden rounded-lg border px-3 py-2 text-sm sm:inline-flex" style={{ borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}>
              登入
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 sm:py-10">{children}</main>
      <footer className="border-t px-4 py-6 text-center text-xs sm:px-6" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        {BRANDING.orgName} · 公開校商購買頁
      </footer>
    </div>
  );
}

function ProtectedShopLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, permissions } = usePermissions();
  const canManage = isAdmin || permissions.has("admin:all") || permissions.has("shop:manage");
  const canViewAll = isAdmin || permissions.has("admin:all") || permissions.has("shop:view_all") || permissions.has("shop:manage_orders") || permissions.has("shop:manage");
  const tabs: ModuleTab[] = [
    { href: "/shop", label: "商品", icon: Store, end: true },
    { href: "/shop/cart", label: "購物車", icon: ShoppingCart },
    { href: "/shop/orders", label: "我的訂單", icon: ClipboardList },
    ...(canViewAll ? [{ href: "/shop/council-orders", label: "班聯管理", icon: BarChart2 }] : []),
    ...(canManage ? [{ href: "/shop/admin", label: "管理", icon: PackageSearch }] : []),
  ];

  return (
    <ModuleBoundary id="shop" skeleton={<ListPageSkeleton />}>
      <ModuleTabs label="商品分頁" tabs={tabs} />
      {children}
    </ModuleBoundary>
  );
}

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/shop" || pathname === "/shop/cart") {
    return <PublicShopChrome>{children}</PublicShopChrome>;
  }
  return <ProtectedShopLayout>{children}</ProtectedShopLayout>;
}
