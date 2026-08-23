"use client";

import Link from "next/link";
import { ChevronDown, LogIn, Menu, Moon, Search, Sun, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { usePublicModuleStatus } from "@/contexts/PublicModuleStatusContext";
import { useTheme } from "@/components/providers/ThemeProvider";
import ImportantAnnouncementBanner, {
  type ImportantAnnouncement,
} from "@/components/site/ImportantAnnouncementBanner";
import PublicEmblem from "@/components/site/PublicEmblem";
import PublicNavIcon from "@/components/site/PublicNavIcon";
import { BRANDING } from "@/lib/branding";
import {
  PUBLIC_NAV_GROUP_META,
  type PublicNavGroupId,
  groupResolvedNav,
  resolvePublicNav,
} from "@/lib/publicNav";
import type { PublicSitePageOut, PublicSiteSettingsOut } from "@/lib/types";

const MENU_GROUP_ORDER: PublicNavGroupId[] = ["primary", "info", "data", "participation"];
const DeferredLiveElectionBanner = lazy(() => import("@/components/site/LiveElectionBanner"));

type PublicHeaderSettings = Pick<
  PublicSiteSettingsOut,
  "site_logo_url" | "site_logo_alt" | "theme_config"
>;
type PublicHeaderNavPage = Pick<PublicSitePageOut, "id" | "slug" | "title" | "nav_label">;

function isCurrentPath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function PublicSiteHeaderContent({
  navPages,
  settings,
  urgentAnnouncement,
}: {
  navPages: PublicHeaderNavPage[];
  settings?: PublicHeaderSettings | null;
  urgentAnnouncement?: ImportantAnnouncement | null;
}) {
  const [open, setOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [liveBannerReady, setLiveBannerReady] = useState(false);
  const [serviceQuery, setServiceQuery] = useState("");
  const { theme, toggleTheme } = useTheme();
  const { statuses } = usePublicModuleStatus();
  const pathname = usePathname();
  const publicEmblemUrl = settings?.site_logo_url?.trim() || BRANDING.publicEmblemUrl;
  const menuRef = useRef<HTMLDetailsElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const moduleStatusReady = Object.keys(statuses).length > 0;
  const closedModuleIds = new Set(
    Object.values(statuses)
      .filter((status) => status.on && status.mode === "closed")
      .map((status) => status.id),
  );

  useEffect(() => {
    setOpen(false);
    setServiceQuery("");
    if (menuRef.current) menuRef.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const dropdown = menuRef.current;
      if (dropdown?.open && !dropdown.contains(target)) dropdown.open = false;
      if (headerRef.current && !headerRef.current.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    const focusFirstMenuControl = () => {
      mobileNavRef.current
        ?.querySelector<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), summary")
        ?.focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [...(mobileNavRef.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), summary",
      ) ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";
    const frame = window.requestAnimationFrame(focusFirstMenuControl);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const resolvedGroups = groupResolvedNav(
    resolvePublicNav(settings?.theme_config as Record<string, unknown> | undefined),
  );
  const groups = {
    primary: resolvedGroups.primary.filter(
      (item) => !moduleStatusReady || !item.moduleId || !closedModuleIds.has(item.moduleId),
    ),
    info: resolvedGroups.info.filter(
      (item) => !moduleStatusReady || !item.moduleId || !closedModuleIds.has(item.moduleId),
    ),
    data: resolvedGroups.data.filter(
      (item) => !moduleStatusReady || !item.moduleId || !closedModuleIds.has(item.moduleId),
    ),
    participation: resolvedGroups.participation.filter(
      (item) => !moduleStatusReady || !item.moduleId || !closedModuleIds.has(item.moduleId),
    ),
  };
  const itemByKey = new Map(Object.values(groups).flat().map((item) => [item.key, item]));
  const taskNav = [
    ["news", "最新公告"],
    ["public-db", "公開資料"],
    ["surveys", "校園調查"],
  ].flatMap(([key, label]) => {
    const item = itemByKey.get(key);
    return item ? [{ ...item, label }] : [];
  });
  const taskNavKeys = new Set(taskNav.map((item) => item.key));
  const menuGroups = MENU_GROUP_ORDER
    .map((id) => ({
      id,
      meta: PUBLIC_NAV_GROUP_META[id],
      items: groups[id].filter((item) => !taskNavKeys.has(item.key)),
    }))
    .filter((group) => group.items.length > 0);
  const normalizedQuery = serviceQuery.trim().toLocaleLowerCase();
  const matchesServiceQuery = (item: { label: string; description?: string }) => {
    if (!normalizedQuery) return true;
    return `${item.label} ${item.description ?? ""}`.toLocaleLowerCase().includes(normalizedQuery);
  };
  const filteredMenuGroups = menuGroups
    .map((group) => ({ ...group, items: group.items.filter(matchesServiceQuery) }))
    .filter((group) => group.items.length > 0);
  const filteredNavPages = navPages.filter((page) => matchesServiceQuery({
    label: page.nav_label || page.title,
    description: page.title,
  }));
  const serviceResultCount = filteredMenuGroups.reduce((count, group) => count + group.items.length, 0)
    + filteredNavPages.length;
  const systemHref = isLoggedIn ? "/dashboard" : "/login?next=%2Fdashboard";
  const systemLabel = isLoggedIn ? "管理系統" : "登入管理";

  useEffect(() => {
    setIsLoggedIn(Boolean(window.localStorage.getItem("user_id")));
  }, []);

  useEffect(() => {
    let idleId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(() => setLiveBannerReady(true), { timeout: 1_000 });
      } else {
        setLiveBannerReady(true);
      }
    }, 3_000);
    return () => {
      window.clearTimeout(timeoutId);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
    };
  }, []);

  return (
    <header className="public-header" ref={headerRef}>
      <Suspense fallback={null}>
        {liveBannerReady && <DeferredLiveElectionBanner />}
      </Suspense>
      <ImportantAnnouncementBanner announcement={urgentAnnouncement} />
      <div className="public-header-inner">
        <Link href="/" className="public-brand" onClick={() => setOpen(false)}>
          <span className="public-brand-mark">
            <PublicEmblem
              src={publicEmblemUrl}
              alt={settings?.site_logo_alt || `${BRANDING.orgShortName}會徽`}
              variant="small"
              className="public-brand-logo"
              sizes="42px"
            />
          </span>
          <span className="min-w-0">
            <span className="block truncate">{BRANDING.orgShortName}</span>
            <span className="block truncate text-xs font-normal text-[var(--public-muted)]">
              {BRANDING.acronym}
            </span>
          </span>
        </Link>
        <nav className="public-desktop-nav" aria-label="公開網站導覽">
          {taskNav.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="public-nav-link"
              aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined}
            >
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
                <label className="public-nav-service-search">
                  <Search size={16} aria-hidden />
                  <span className="sr-only">搜尋公開服務</span>
                  <input
                    type="search"
                    value={serviceQuery}
                    onChange={(event) => setServiceQuery(event.target.value)}
                    placeholder="搜尋公開服務，例如：公文、問卷、優惠"
                  />
                  {normalizedQuery && <span aria-live="polite">{serviceResultCount} 項結果</span>}
                </label>
                {filteredMenuGroups.map((group) => (
                  <section key={group.id}>
                    <p className="public-nav-dropdown-label">
                      <span>{group.meta.label}</span>
                      {group.meta.hint && (
                        <span className="public-nav-dropdown-hint">{group.meta.hint}</span>
                      )}
                    </p>
                    <div className="grid gap-0.5">
                      {group.items.map((item) => (
                        <Link
                          key={item.key}
                          href={item.href}
                          className="public-nav-dropdown-link"
                          aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined}
                        >
                          <span className="public-nav-dropdown-icon" aria-hidden="true">
                            <PublicNavIcon iconKey={item.iconKey} size={18} />
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
                      ))}
                    </div>
                  </section>
                ))}
                {filteredNavPages.length > 0 && (
                  <section>
                    <p className="public-nav-dropdown-label">其他公開頁面</p>
                    <div className="grid gap-0.5">
                      {filteredNavPages.map((page) => (
                        <Link
                          key={page.id}
                          href={`/pages/${page.slug}`}
                          className="public-nav-dropdown-link"
                          aria-current={isCurrentPath(pathname, `/pages/${page.slug}`) ? "page" : undefined}
                        >
                          <span className="min-w-0 text-sm font-semibold">{page.nav_label || page.title}</span>
                        </Link>
                      ))}
                    </div>
                  </section>
                )}
                {normalizedQuery && serviceResultCount === 0 && (
                  <p className="public-nav-empty">找不到相符服務；請改用其他關鍵字。</p>
                )}
              </div>
            </details>
          )}
        </nav>
        <div className="public-header-actions">
          <button
            type="button"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const useButtonCenter = window.matchMedia("(pointer: coarse)").matches
                || event.detail === 0;
              const origin = useButtonCenter
                ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
                : { x: event.clientX, y: event.clientY };
              toggleTheme({ ...origin, target: event.currentTarget });
            }}
            className="public-icon-button"
            aria-label={theme === "dark" ? "切換淺色模式" : "切換深色模式"}
          >
            {theme === "dark" ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
          </button>
          <Link href={systemHref} className="public-system-button hidden sm:inline-flex">
            <LogIn size={15} aria-hidden />
            {systemLabel}
          </Link>
          <button
            ref={menuButtonRef}
            type="button"
            className={`public-menu-button ${open ? "is-open" : ""}`}
            onClick={() => {
              if (menuRef.current) menuRef.current.open = false;
              setOpen((value) => !value);
            }}
            aria-expanded={open}
            aria-controls="public-mobile-nav"
            aria-label={open ? "關閉導覽" : "開啟導覽"}
          >
            {open ? <X size={21} aria-hidden /> : <Menu size={21} aria-hidden />}
          </button>
        </div>
      </div>
      {open && (
        <>
          <button
            type="button"
            className="public-mobile-backdrop"
            aria-label="關閉導覽"
            onClick={() => setOpen(false)}
          />
          <nav
            id="public-mobile-nav"
            ref={mobileNavRef}
            className="public-mobile-nav public-mobile-nav-index"
            aria-label="公開網站行動導覽"
          >
            <p className="public-mobile-nav-heading">你想先做什麼？</p>
            <div className="grid gap-2">
              {taskNav.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="public-mobile-link public-mobile-index-link"
                  aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined}
                >
                  {item.label}
                  {item.guestUsable && <span className="public-nav-badge">免登入</span>}
                </Link>
              ))}
            </div>
            <label className="public-mobile-service-search">
              <Search size={16} aria-hidden />
              <span className="sr-only">搜尋所有公開服務</span>
              <input
                type="search"
                value={serviceQuery}
                onChange={(event) => setServiceQuery(event.target.value)}
                placeholder="搜尋所有公開服務"
              />
            </label>
            <div className="mt-4 grid gap-3">
              {filteredMenuGroups.map((group) => (
                <details key={group.id} className="public-mobile-service-group" open={Boolean(normalizedQuery)}>
                  <summary className="public-mobile-group-label">
                    <span>{group.meta.label}</span>
                    <ChevronDown size={16} aria-hidden />
                  </summary>
                  <div className="grid gap-2 pt-2 sm:grid-cols-2">
                    {group.items.map((item) => (
                      <Link
                        key={item.key}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className="public-mobile-service-link"
                        aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined}
                      >
                        <span className="public-nav-dropdown-icon" aria-hidden="true">
                          <PublicNavIcon iconKey={item.iconKey} size={18} />
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
                    ))}
                  </div>
                </details>
              ))}
              {filteredNavPages.length > 0 && (
                <details className="public-mobile-service-group" open={Boolean(normalizedQuery)}>
                  <summary className="public-mobile-group-label">
                    <span>其他公開頁面</span>
                    <ChevronDown size={16} aria-hidden />
                  </summary>
                  <div className="grid gap-2 pt-2 sm:grid-cols-2">
                    {filteredNavPages.map((page) => (
                      <Link
                        key={page.id}
                        href={`/pages/${page.slug}`}
                        onClick={() => setOpen(false)}
                        className="public-mobile-service-link"
                        aria-current={isCurrentPath(pathname, `/pages/${page.slug}`) ? "page" : undefined}
                      >
                        <span className="min-w-0 text-sm font-semibold">{page.nav_label || page.title}</span>
                      </Link>
                    ))}
                  </div>
                </details>
              )}
              {normalizedQuery && serviceResultCount === 0 && (
                <p className="public-nav-empty" aria-live="polite">找不到相符服務；請改用其他關鍵字。</p>
              )}
              <Link href={systemHref} className="public-system-button">
                <LogIn size={15} aria-hidden />
                {systemLabel}
              </Link>
            </div>
          </nav>
        </>
      )}
    </header>
  );
}

export default function PublicSiteHeader(props: {
  navPages?: PublicHeaderNavPage[];
  settings?: PublicHeaderSettings | null;
  urgentAnnouncement?: ImportantAnnouncement | null;
}) {
  return (
    <PublicSiteHeaderContent
      navPages={props.navPages ?? []}
      settings={props.settings}
      urgentAnnouncement={props.urgentAnnouncement}
    />
  );
}
