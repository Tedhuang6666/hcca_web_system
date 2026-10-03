"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ModuleBoundary from "@/components/ModuleBoundary";
import ModuleTabs, { type ModuleTab } from "@/components/layout/ModuleTabs";
import PageTransition from "@/components/layout/PageTransition";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import PublicModuleStatusProvider from "@/contexts/PublicModuleStatusContext";
import PublicSiteHeader from "@/components/site/PublicSiteHeader";
import { usePermissions } from "@/hooks/usePermissions";
import { BarChart2, ClipboardList, ListChecks, PackageSearch, Store } from "lucide-react";
import PublicEmblem from "@/components/site/PublicEmblem";
import { BRANDING } from "@/lib/branding";

import "../../public-design-system.css";
import "../../(public)/public-footer.css";
import "./shop-public.css";

function PublicShopChrome({ children }: { children: React.ReactNode }) {
  return (
    <PublicModuleStatusProvider>
      <div className="public-site min-h-screen text-[var(--public-text)]">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--public-surface)] focus:px-3 focus:py-2"
        >
          跳到主要內容
        </a>
        <PublicSiteHeader />
        <main id="main-content">
          <PageTransition>{children}</PageTransition>
        </main>
        <footer className="public-footer">
          <div className="public-footer-inner">
            <div className="public-footer-brand">
              <Link href="/" className="public-footer-brand-link">
                <span className="public-footer-mark" aria-hidden="true">
                  <PublicEmblem
                    src={BRANDING.publicEmblemUrl}
                    alt=""
                    variant="small"
                    className="h-full w-full object-contain"
                    sizes="36px"
                  />
                </span>
                <span>
                  <strong>{BRANDING.orgName}</strong>
                  <span>數位整合系統</span>
                </span>
              </Link>
            </div>
            <nav className="public-footer-links" aria-label="頁尾導覽">
              <span className="public-footer-label">快速連結</span>
              <Link href="/shop">商品訂購</Link>
              <Link href="/shop/orders">我的登記</Link>
              <Link href="/public">公開資料庫</Link>
            </nav>
            <nav className="public-footer-links" aria-label="法律與無障礙資訊">
              <span className="public-footer-label">網站資訊</span>
              <Link href="/legal/accessibility">無障礙聲明</Link>
              <Link href="/legal/privacy">隱私政策</Link>
            </nav>
          </div>
          <div className="public-footer-bottom">
            <span>{BRANDING.orgShortName} · {BRANDING.platformName}</span>
          </div>
        </footer>
      </div>
    </PublicModuleStatusProvider>
  );
}

function ProtectedShopLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, permissions } = usePermissions();
  const canManage = isAdmin || permissions.has("admin:all") || permissions.has("shop:manage");
  const canViewAll = isAdmin || permissions.has("admin:all") || permissions.has("shop:view_all") || permissions.has("shop:manage_orders") || permissions.has("shop:manage");
  const canCollectForClass = permissions.has("class:shop_collect");
  const tabs: ModuleTab[] = [
    { href: "/shop", label: "商品", icon: Store, end: true },
    { href: "/shop/orders", label: "我的登記", icon: ClipboardList },
    ...(canCollectForClass ? [{ href: "/shop/class-orders", label: "班級收款", icon: ListChecks }] : []),
    ...(canViewAll ? [{ href: "/shop/council-orders", label: "班聯管理", icon: BarChart2 }] : []),
    ...(canManage ? [{ href: "/shop/admin", label: "商品管理", icon: PackageSearch }] : []),
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
