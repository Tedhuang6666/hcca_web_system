"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  LogIn,
  Menu,
  Moon,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import BrandEmblem from "@/components/brand/BrandEmblem";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import LiveElectionBanner from "@/components/site/LiveElectionBanner";
import { useTheme } from "@/components/providers/ThemeProvider";
import { BRANDING } from "@/lib/branding";
import {
  PUBLIC_NAV_GROUP_META,
  type PublicNavGroupId,
  groupResolvedNav,
  resolvePublicNav,
} from "@/lib/publicNav";
import type { PublicSitePageOut, PublicSiteSettingsOut } from "@/lib/types";

/** 已知父層路徑 → 返回鈕文案。未列出者依前綴給通用文案。 */
const PUBLIC_BACK_LABELS: Record<string, string> = {
  "/public": "返回公開資料庫",
  "/public/elections": "返回即時開票",
  "/public/documents": "返回公開公文",
  "/public/regulations": "返回公開法規",
  "/news": "返回最新公告",
};

/** 收進「所有公開服務」選單的群組順序（primary 在頂列，不在此列）。 */
const MENU_GROUP_ORDER: PublicNavGroupId[] = ["info", "data", "participation"];

/**
 * 依 pathname 推算公開站的「返回上一層」目標。
 * 公開站不渲染系統 Topbar（無全域返回鈕），故深層頁的返回鈕一律由此集中提供。
 * - /news/<id>            → /news
 * - /public/... 之下任一層 → 去掉最後一段的父路徑
 * 頂層導覽頁（/、/about、/public、/pages/<slug> 等）回傳 null，不顯示返回鈕。
 */
function getPublicBack(pathname: string): { href: string; label: string } | null {
  let parent: string | null = null;
  if (/^\/news\/[^/]+$/.test(pathname)) {
    parent = "/news";
  } else if (pathname.startsWith("/public/")) {
    parent = "/" + pathname.split("/").filter(Boolean).slice(0, -1).join("/");
  }
  if (!parent) return null;

  const label =
    PUBLIC_BACK_LABELS[parent] ??
    (parent.startsWith("/public/regulations") ? "返回法規" :
     parent.startsWith("/public/documents") ? "返回公文" : "返回上一頁");
  return { href: parent, label };
}

export default function PublicSiteShell({
  children,
  navPages = [],
  settings,
}: {
  children: React.ReactNode;
  navPages?: PublicSitePageOut[];
  settings?: PublicSiteSettingsOut | null;
}) {
  const [open, setOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();
  useScrollReveal([]);
  const back = getPublicBack(pathname);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  // 換頁時收合所有導覽（手機抽屜 + 桌面 mega-menu）。
  useEffect(() => {
    setOpen(false);
    if (menuRef.current) menuRef.current.open = false;
  }, [pathname]);

  // 點導覽列以外的任何地方就收合：桌面 mega-menu（原生 <details> 不會自動關）與手機抽屜。
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const dropdown = menuRef.current;
      if (dropdown?.open && !dropdown.contains(target)) {
        dropdown.open = false;
      }
      if (headerRef.current && !headerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  // 內建導覽項目（單一來源）+ 後台覆寫（theme_config.nav），primary 上頂列、其餘進選單。
  const groups = groupResolvedNav(
    resolvePublicNav(settings?.theme_config as Record<string, unknown> | undefined),
  );
  const topLevel = [
    { key: "__home", href: "/", label: "首頁", guestUsable: false },
    ...groups.primary.map((item) => ({
      key: item.key,
      href: item.href,
      label: item.label,
      guestUsable: item.guestUsable === true,
    })),
    ...navPages.map((page) => ({
      key: `page-${page.slug}`,
      href: `/pages/${page.slug}`,
      label: page.nav_label || page.title,
      guestUsable: true,
    })),
  ];
  const menuGroups = MENU_GROUP_ORDER
    .map((id) => ({ id, meta: PUBLIC_NAV_GROUP_META[id], items: groups[id] }))
    .filter((group) => group.items.length > 0);

  const systemHref = isLoggedIn ? "/dashboard" : "/login?next=%2Fdashboard";
  const systemLabel = isLoggedIn ? "管理系統" : "登入管理";

  useEffect(() => {
    setIsLoggedIn(Boolean(window.localStorage.getItem("user_id")));
  }, []);

  return (
    <div className="public-site min-h-screen text-[var(--public-text)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--public-surface)] focus:px-3 focus:py-2">
        跳到主要內容
      </a>
      {open && (
        <button
          type="button"
          className="public-mobile-backdrop"
          aria-label="關閉導覽"
          onClick={() => setOpen(false)}
        />
      )}
      <header className="public-header" ref={headerRef}>
        <LiveElectionBanner />
        <div className="public-header-inner">
          <Link href="/" className="public-brand" onClick={() => setOpen(false)}>
            <span className="public-brand-mark" aria-hidden={!settings?.site_logo_url}>
              {settings?.site_logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={settings.site_logo_url}
                  alt={settings.site_logo_alt || `${BRANDING.orgShortName}會徽`}
                  className="public-brand-logo"
                />
              ) : (
                <BrandEmblem size={42} />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate">{BRANDING.orgShortName}</span>
              <span className="block truncate text-xs font-normal text-[var(--public-muted)]">
                {BRANDING.acronym}
              </span>
            </span>
          </Link>
          <nav className="public-desktop-nav" aria-label="公開網站導覽">
            {topLevel.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="public-nav-link">
                {item.label}
                {item.guestUsable && <span className="public-nav-badge">免登入</span>}
              </Link>
            ))}
            {menuGroups.length > 0 && (
              <details
                className="public-nav-dropdown"
                ref={menuRef}
                onToggle={(event) => {
                  if ((event.currentTarget as HTMLDetailsElement).open) setOpen(false);
                }}
              >
                <summary className="public-nav-link cursor-pointer list-none">
                  所有公開服務
                  <ChevronDown size={15} aria-hidden />
                </summary>
                <div className="public-nav-dropdown-panel">
                  {menuGroups.map((group) => (
                    <section key={group.id}>
                      <p className="public-nav-dropdown-label">
                        <span>{group.meta.label}</span>
                        {group.meta.hint && (
                          <span className="public-nav-dropdown-hint">{group.meta.hint}</span>
                        )}
                      </p>
                      <div className="grid gap-0.5">
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          return (
                            <Link key={item.key} href={item.href} className="public-nav-dropdown-link">
                              <span className="public-nav-dropdown-icon">
                                <Icon size={17} aria-hidden />
                              </span>
                              <span className="min-w-0">
                                <span className="flex items-center gap-1.5">
                                  <span className="text-sm font-semibold">{item.label}</span>
                                  {item.guestUsable && !group.meta.hint && (
                                    <span className="public-nav-badge">免登入</span>
                                  )}
                                </span>
                                <span className="mt-0.5 block text-xs text-[var(--public-muted)]">
                                  {item.description}
                                </span>
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </details>
            )}
          </nav>
          <div className="public-header-actions">
            <button
              type="button"
              onClick={toggleTheme}
              className="public-icon-button"
              aria-label={theme === "dark" ? "切換淺色模式" : "切換深色模式"}>
              {theme === "dark" ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
            </button>
            <Link href={systemHref} className="public-system-button hidden sm:inline-flex">
              <LogIn size={15} aria-hidden />
              {systemLabel}
            </Link>
            <button
              type="button"
              className="public-menu-button"
              onClick={() => {
                if (menuRef.current) menuRef.current.open = false;
                setOpen((value) => !value);
              }}
              aria-expanded={open}
              aria-controls="public-mobile-nav"
              aria-label={open ? "關閉導覽" : "開啟導覽"}>
              {open ? <X size={21} aria-hidden /> : <Menu size={21} aria-hidden />}
            </button>
          </div>
        </div>
        {open && (
          <nav
            id="public-mobile-nav"
            className="public-mobile-nav"
            aria-label="公開網站行動導覽">
            <div className="grid gap-2">
              {topLevel.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="public-mobile-link">
                  {item.label}
                  {item.guestUsable && <span className="public-nav-badge">免登入</span>}
                </Link>
              ))}
            </div>
            <div className="mt-4 grid gap-4">
              {menuGroups.map((group) => (
                <section key={group.id}>
                  <p className="public-mobile-group-label">
                    <span>{group.meta.label}</span>
                    {group.meta.hint && (
                      <span className="public-nav-dropdown-hint">{group.meta.hint}</span>
                    )}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.key}
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className="public-mobile-service-link"
                        >
                          <span className="public-nav-dropdown-icon">
                            <Icon size={16} aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-semibold">{item.label}</span>
                              {item.guestUsable && !group.meta.hint && (
                                <span className="public-nav-badge">免登入</span>
                              )}
                            </span>
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
              <Link href={systemHref} className="public-system-button">
                <LogIn size={15} aria-hidden />
                {systemLabel}
              </Link>
            </div>
          </nav>
        )}
      </header>
      <main id="main-content">
        {back && (
          <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6">
            <Link href={back.href} className="public-back-link">
              <ArrowLeft size={16} aria-hidden />
              {back.label}
            </Link>
          </div>
        )}
        {children}
      </main>
      <footer className="public-footer">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm sm:px-6 md:flex-row md:items-center md:justify-between">
          <p>{BRANDING.orgName}</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/legal/accessibility" className="hover:underline">無障礙聲明</Link>
            <Link href="/legal/privacy" className="hover:underline">隱私政策</Link>
            <Link href="/public" className="hover:underline">公開資料庫</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
