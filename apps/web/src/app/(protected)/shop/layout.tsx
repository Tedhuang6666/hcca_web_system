"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import ModuleBoundary from "@/components/ModuleBoundary";
import type { ModuleTab } from "@/components/layout/ModuleTabs";
import PageTransition from "@/components/layout/PageTransition";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import PublicModuleStatusProvider from "@/contexts/PublicModuleStatusContext";
import PublicSiteHeader from "@/components/site/PublicSiteHeader";
import { usePermissions } from "@/hooks/usePermissions";
import { BarChart2, ListChecks, PackageSearch } from "lucide-react";
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
              <Link href="/shop/orders">我的訂單</Link>
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

function getShopTabs(isAdmin: boolean, permissions: Set<string>): ModuleTab[] {
  const canManage = isAdmin || permissions.has("admin:all") || permissions.has("shop:manage");
  const canViewAll = isAdmin
    || permissions.has("admin:all")
    || permissions.has("shop:view_all")
    || permissions.has("shop:manage_orders")
    || permissions.has("shop:manage");
  const canCollectForClass = permissions.has("class:shop_collect");

  return [
    ...(canCollectForClass ? [{ href: "/shop/class-orders", label: "收款與代訂", icon: ListChecks }] : []),
    ...(canViewAll ? [{ href: "/shop/council-orders", label: "全校訂單總覽", icon: BarChart2 }] : []),
    ...(canManage ? [{ href: "/shop/admin", label: "商品與活動設定", icon: PackageSearch }] : []),
  ];
}

type ShopNavigationGroup = {
  label: string;
  tabs: ModuleTab[];
};

function groupShopTabs(tabs: ModuleTab[]): ShopNavigationGroup[] {
  return [
    {
      label: "班代",
      tabs: tabs.filter((tab) => tab.href === "/shop/class-orders"),
    },
    {
      label: "班聯統籌",
      tabs: tabs.filter((tab) => tab.href === "/shop/council-orders" || tab.href === "/shop/admin"),
    },
  ].filter((group) => group.tabs.length > 0);
}

function ShopWorkspaceNavigation({ groups }: { groups: ShopNavigationGroup[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <nav
      aria-label="商品工作區"
      className="shop-workspace-navigation mx-auto mb-5 w-full max-w-7xl px-4 pt-4"
    >
      {groups.map((group) => (
        <section key={group.label} className="shop-workspace-group" aria-label={`${group.label}功能`}>
          <h2 className="shop-workspace-label">{group.label}</h2>
          <div className="shop-workspace-links">
            {group.tabs.map((tab) => {
              const [tabPath, tabQuery] = tab.href.split("?", 2);
              const tabParams = new URLSearchParams(tabQuery ?? "");
              const queryMatches = [...tabParams.entries()].every(
                ([key, value]) => searchParams.get(key) === value,
              );
              const active = tab.end
                ? pathname === tabPath && searchParams.toString() === ""
                : (pathname === tabPath || pathname.startsWith(`${tabPath}/`)) && queryMatches;
              const Icon = tab.icon;

              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`shop-workspace-tab${active ? " is-active" : ""}`}
                >
                  <Icon size={15} aria-hidden={true} />
                  <span>{tab.label}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}

function ShopWorkspaceDenied({ section }: { section: "class" | "oversight" | "manage" }) {
  const message = section === "class"
    ? "這個工作區提供給負責班級收款與代訂的人員。"
    : section === "oversight"
      ? "這個工作區提供給負責統籌全校訂單的班聯人員。"
      : "這個工作區提供給負責商品與活動設定的班聯人員。";

  return (
    <main className="mx-auto my-8 max-w-xl px-4" role="alert">
      <section className="rounded-lg p-6" style={{ border: "1px solid var(--border)", background: "var(--card-bg)" }}>
        <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          目前帳號無法進入這個工作區
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>{message}</p>
        <Link href="/shop" className="btn btn-secondary mt-4 min-h-11">
          回到商品目錄
        </Link>
      </section>
    </main>
  );
}

function ProtectedShopLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isAdmin, isReady, permissions } = usePermissions();
  const tabs = getShopTabs(isAdmin, permissions);
  const groups = groupShopTabs(tabs);
  const requiredSection = pathname.startsWith("/shop/class-orders")
    ? "class"
    : pathname.startsWith("/shop/council-orders")
      ? "oversight"
      : pathname.startsWith("/shop/admin")
        ? "manage"
        : null;
  const hasWorkspaceAccess = isAdmin
    || permissions.has("admin:all")
    || (requiredSection === "class" && permissions.has("class:shop_collect"))
    || (requiredSection === "oversight" && [
      "shop:view_all", "shop:manage_orders", "shop:manage",
    ].some((permission) => permissions.has(permission)))
    || (requiredSection === "manage" && permissions.has("shop:manage"));
  const waitingForPermissions = requiredSection !== null && !isReady;

  return (
    <ModuleBoundary id="shop" skeleton={<ListPageSkeleton />}>
      {groups.length > 0 && <ShopWorkspaceNavigation groups={groups} />}
      {waitingForPermissions ? (
        <ListPageSkeleton />
      ) : requiredSection && !hasWorkspaceAccess ? (
        <ShopWorkspaceDenied section={requiredSection} />
      ) : (
        children
      )}
    </ModuleBoundary>
  );
}

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/shop" || pathname === "/shop/cart"
    || pathname === "/shop/orders" || pathname.startsWith("/shop/orders/")) {
    return (
      <PublicShopChrome>
        {children}
      </PublicShopChrome>
    );
  }
  return <ProtectedShopLayout>{children}</ProtectedShopLayout>;
}
