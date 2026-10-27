"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import ModuleBoundary from "@/components/ModuleBoundary";
import type { ModuleTab } from "@/components/layout/ModuleTabs";
import PageTransition from "@/components/layout/PageTransition";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import PublicModuleStatusProvider from "@/contexts/PublicModuleStatusContext";
import PublicSiteHeader from "@/components/site/PublicSiteHeader";
import { usePermissions } from "@/hooks/usePermissions";
import { authApi } from "@/lib/api/auth";
import { cacheCurrentUser } from "@/lib/auth-cache";
import { BarChart2, ChevronDown, ClipboardList, ListChecks, PackageSearch, ShoppingBag, UsersRound } from "lucide-react";
import PublicEmblem from "@/components/site/PublicEmblem";
import { BRANDING } from "@/lib/branding";

import "../../public-design-system.css";
import "../../(public)/public-footer.css";
import "./shop-public.css";

function PublicShopChrome({ children }: { children: React.ReactNode }) {
  const { isAdmin, permissions } = usePermissions();
  useEffect(() => {
    let active = true;
    void authApi.refresh().then((user) => {
      if (active) cacheCurrentUser(user);
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, []);

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
        <ShopWorkspaceNavigation groups={groupShopTabs(getShopTabs(isAdmin, permissions))} />
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
              <Link href="/shop/orders">我的預購</Link>
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
  const canCollectForClass = isAdmin || permissions.has("admin:all") || permissions.has("class:shop_collect");
  const canManageClasses = isAdmin || permissions.has("admin:all") || permissions.has("class:manage");

  return [
    { href: "/shop", label: "商品目錄", icon: ShoppingBag, end: true },
    { href: "/shop/orders", label: "我的預購", icon: ClipboardList },
    ...(canCollectForClass ? [{ href: "/shop/class-orders", label: "班代代訂與收款", icon: ListChecks }] : []),
    ...(canViewAll ? [{ href: "/shop/council-orders", label: "班聯工作", icon: BarChart2 }] : []),
    ...(canManage ? [{ href: "/shop/admin", label: "商品設定", icon: PackageSearch }] : []),
    ...(canManageClasses ? [{ href: "/admin/people?section=classes", label: "班級與議員設定", icon: UsersRound }] : []),
  ];
}

type ShopNavigationGroup = {
  label: string;
  tabs: ModuleTab[];
};

function groupShopTabs(tabs: ModuleTab[]): ShopNavigationGroup[] {
  const councilTab = tabs.find((tab) => tab.href === "/shop/council-orders");
  const classTab = tabs.find((tab) => tab.href === "/shop/class-orders");
  return [
    {
      label: "預購",
      tabs: tabs.filter((tab) => tab.href === "/shop" || tab.href === "/shop/orders"),
    },
    { label: "班代工作", tabs: classTab ? [classTab] : [] },
    { label: "班聯工作", tabs: councilTab ? [councilTab] : [] },
    {
      label: "其他工具",
      tabs: tabs.filter((tab) => !["/shop", "/shop/orders", "/shop/class-orders", "/shop/council-orders"].includes(tab.href)),
    },
  ].filter((group) => group.tabs.length > 0);
}

function ShopWorkspaceNavigation({ groups }: { groups: ShopNavigationGroup[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (groups.length === 0) return null;
  const managementPage = pathname.startsWith("/shop/council-orders") || pathname.startsWith("/shop/admin");
  const preorderTabs = groups.find((group) => group.label === "預購")?.tabs ?? [];
  const storefront = pathname === "/shop" || pathname === "/shop/cart"
    || pathname === "/shop/orders" || pathname.startsWith("/shop/orders/");
  const visibleGroups = storefront
    ? [
      { label: "預購", tabs: preorderTabs },
      ...groups.filter((group) => group.label === "班代工作"),
      { label: "其他工具", tabs: groups.filter((group) => !["預購", "班代工作"].includes(group.label)).flatMap((group) => group.tabs) },
    ].filter((group) => group.tabs.length > 0)
    : managementPage
    ? groups.filter((group) => group.label !== "預購").map((group) => group.label === "其他工具"
      ? { ...group, tabs: [...group.tabs, ...preorderTabs] }
      : group)
    : groups;

  const isActive = (tab: ModuleTab) => {
    const [tabPath, tabQuery] = tab.href.split("?", 2);
    const queryMatches = [...new URLSearchParams(tabQuery ?? "").entries()].every(
      ([key, value]) => searchParams.get(key) === value,
    );
    const matchesPath = tab.end
      ? pathname === tabPath
      : pathname === tabPath || pathname.startsWith(`${tabPath}/`);
    return matchesPath && queryMatches;
  };
  const links = (group: ShopNavigationGroup) => (
    <div className="shop-workspace-links">
      {group.tabs.map((tab) => {
        const active = isActive(tab);
        const Icon = tab.icon;
        return <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined}
          className={`shop-workspace-tab${active ? " is-active" : ""}`}>
          <Icon size={15} aria-hidden />
          <span>{tab.label}</span>
        </Link>;
      })}
    </div>
  );

  return (
    <nav
      aria-label="商品工作區"
      className={`shop-workspace-navigation mx-auto mb-5 w-full max-w-7xl px-4 pt-4${storefront ? " shop-storefront-navigation" : ""}`}
    >
      {visibleGroups.map((group) => group.label !== "其他工具" ? (
        <section key={group.label} className={`shop-workspace-group${group.label === "班代工作" ? " shop-representative-entry" : group.label === "班聯工作" ? " shop-council-entry" : ""}`} aria-label={`${group.label}功能`}>
          <h2 className="shop-workspace-group-label sr-only md:not-sr-only">{group.label}</h2>
          {links(group)}
        </section>
      ) : (
        <details key={`${group.label}:${pathname}:${searchParams.toString()}`} className="shop-workspace-menu">
          <summary>
            <span>{group.label}</span>
            {group.tabs.find(isActive) && <strong>{group.tabs.find(isActive)?.label}</strong>}
            <ChevronDown size={16} aria-hidden />
          </summary>
          {links(group)}
        </details>
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
  const [classPermissionCheck, setClassPermissionCheck] = useState<"idle" | "checking" | "done">("idle");
  const classPermissionRefreshStarted = useRef(false);
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
  useEffect(() => {
    if (requiredSection !== "class") {
      classPermissionRefreshStarted.current = false;
      setClassPermissionCheck("idle");
      return;
    }
    if (!isReady || classPermissionRefreshStarted.current) return;

    classPermissionRefreshStarted.current = true;
    setClassPermissionCheck("checking");
    void authApi.refresh().then(
      (user) => {
        cacheCurrentUser(user);
        setClassPermissionCheck("done");
      },
      () => setClassPermissionCheck("done"),
    );
  }, [isReady, requiredSection]);

  const waitingForPermissions = (requiredSection !== null && !isReady)
    || (requiredSection === "class" && classPermissionCheck !== "done");

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
