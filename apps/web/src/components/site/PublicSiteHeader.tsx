"use client";

import Link from "@/components/ui/IntentLink";
import { ChevronDown, LogIn, Menu, Moon, Search, Sun, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { usePublicModuleStatus } from "@/contexts/PublicModuleStatusContext";
import { useTheme } from "@/components/providers/ThemeProvider";
import ImportantAnnouncementBanner, {
  type ImportantAnnouncement,
} from "@/components/site/ImportantAnnouncementBanner";
import PublicEmblem from "@/components/site/PublicEmblem";
import { BRANDING } from "@/lib/branding";
import {
  PUBLIC_NAV_GROUP_META,
  type ResolvedNavItem,
  groupResolvedNav,
  publicPageHref,
  resolvePublicNav,
} from "@/lib/publicNav";
import type { PublicSitePageOut, PublicSiteSettingsOut } from "@/lib/types";

const DeferredLiveElectionBanner = lazy(() => import("@/components/site/LiveElectionBanner"));
/** 窄於此寬度時改用側拉選單，避免頁首連結擠在一起。 */
const DESKTOP_NAV_QUERY = "(min-width: 960px)";

type PublicHeaderSettings = Pick<
  PublicSiteSettingsOut,
  "site_logo_url" | "site_logo_alt" | "theme_config"
>;
type PublicHeaderNavPage = Pick<PublicSitePageOut, "id" | "slug" | "title" | "nav_label" | "page_kind">;
type HeaderLink = { key: string; href: string; label: string };
type HeaderGroup = { id: string; label: string; items: HeaderLink[] };

function isCurrentPath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function closeDropdowns(root: HTMLElement | null, except?: Element) {
  root?.querySelectorAll<HTMLDetailsElement>("details.public-nav-dropdown[open]").forEach((dropdown) => {
    if (dropdown !== except) dropdown.open = false;
  });
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
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);
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
    closeDropdowns(headerRef.current);
  }, [pathname]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const header = headerRef.current;
      const insideDropdown = (target as Element).closest?.("details.public-nav-dropdown") ?? undefined;
      closeDropdowns(header, insideDropdown);
      if (header && !header.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const dropdown = headerRef.current?.querySelector<HTMLDetailsElement>("details.public-nav-dropdown[open]");
      if (!dropdown) return;
      dropdown.open = false;
      dropdown.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
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
      ) ?? [])].filter((element) => element.getClientRects().length > 0);
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
    const desktopMedia = window.matchMedia(DESKTOP_NAV_QUERY);
    const closeOnDesktop = () => {
      if (desktopMedia.matches) setOpen(false);
    };
    desktopMedia.addEventListener("change", closeOnDesktop);
    const frame = window.requestAnimationFrame(focusFirstMenuControl);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
      desktopMedia.removeEventListener("change", closeOnDesktop);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const resolvedGroups = groupResolvedNav(
    resolvePublicNav(settings?.theme_config as Record<string, unknown> | undefined),
  );
  const available = (item: ResolvedNavItem) =>
    !moduleStatusReady || !item.moduleId || !closedModuleIds.has(item.moduleId);
  const toLinks = (items: ResolvedNavItem[]): HeaderLink[] =>
    items.filter(available).map(({ key, href, label }) => ({ key, href, label }));
  const descriptions = new Map(
    [...resolvedGroups.primary, ...resolvedGroups.data, ...resolvedGroups.info]
      .map((item) => [item.key, item.description.toLocaleLowerCase()]),
  );
  const primaryLinks = toLinks(resolvedGroups.primary);
  const customPages: HeaderLink[] = navPages
    .filter((page) => page.page_kind !== "article")
    .map((page) => ({ key: `page:${page.id}`, href: publicPageHref(page), label: page.nav_label || page.title }));
  const menuGroups: HeaderGroup[] = [
    { id: "data", label: PUBLIC_NAV_GROUP_META.data.label, items: toLinks(resolvedGroups.data) },
    { id: "info", label: PUBLIC_NAV_GROUP_META.info.label, items: [...toLinks(resolvedGroups.info), ...customPages] },
  ].filter((group) => group.items.length > 0);

  const normalizedQuery = serviceQuery.trim().toLocaleLowerCase();
  const searchResults: HeaderLink[] = normalizedQuery
    ? [
      ...primaryLinks,
      ...menuGroups.flatMap((group) => group.items),
      ...navPages
        .filter((page) => page.page_kind === "article")
        .map((page) => ({ key: `page:${page.id}`, href: publicPageHref(page), label: page.nav_label || page.title })),
    ].filter((item) => item.label.toLocaleLowerCase().includes(normalizedQuery)
      || descriptions.get(item.key)?.includes(normalizedQuery))
    : [];
  const systemHref = isLoggedIn ? "/dashboard" : "/login?next=%2Fdashboard";
  const systemLabel = isLoggedIn ? "前往平台" : "登入平台";

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

  const renderMobileLink = (item: HeaderLink) => (
    <Link
      key={item.key}
      href={item.href}
      onClick={() => setOpen(false)}
      className="public-mobile-service-link"
      aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined}
    >
      {item.label}
    </Link>
  );

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
              priority
            />
          </span>
          <span className="min-w-0">
            <span className="block whitespace-nowrap text-[13px] sm:text-sm">{BRANDING.orgShortName}</span>
            <span className="block whitespace-nowrap text-xs font-normal text-[var(--public-muted)] sm:text-xs">
              {BRANDING.acronym}
            </span>
          </span>
        </Link>
        <nav className="public-desktop-nav" aria-label="公開網站導覽">
          {primaryLinks.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="public-nav-link"
              aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
          {menuGroups.map((group) => {
            const groupCurrent = group.items.some((item) => isCurrentPath(pathname, item.href));
            return (
              <details
                key={group.id}
                className="public-nav-dropdown"
                onToggle={(event) => {
                  const dropdown = event.currentTarget;
                  if (dropdown.open) {
                    setOpen(false);
                    closeDropdowns(headerRef.current, dropdown);
                  }
                }}
              >
                <summary className="public-nav-link" data-current={groupCurrent || undefined}>
                  {group.label}
                  <ChevronDown size={15} aria-hidden />
                </summary>
                <div className="public-nav-dropdown-panel">
                  {group.items.map((item) => (
                    <Link
                      key={item.key}
                      href={item.href}
                      className="public-nav-dropdown-link"
                      aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </details>
            );
          })}
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
              closeDropdowns(headerRef.current);
              setServiceQuery("");
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
            onClick={() => {
              setOpen(false);
              menuButtonRef.current?.focus();
            }}
          />
          <div
            id="public-mobile-nav"
            ref={mobileNavRef}
            className="public-mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="公開網站導覽"
          >
            <div className="public-mobile-menu-header">
              <button
                type="button"
                className="public-icon-button public-mobile-menu-close"
                aria-label="關閉導覽"
                onClick={() => {
                  setOpen(false);
                  menuButtonRef.current?.focus();
                }}
              >
                <X size={20} aria-hidden />
              </button>
              <label className="public-mobile-service-search">
                <Search size={18} aria-hidden />
                <span className="sr-only">搜尋頁面</span>
                <input
                  type="search"
                  value={serviceQuery}
                  onChange={(event) => setServiceQuery(event.target.value)}
                  placeholder="搜尋頁面"
                />
              </label>
            </div>
            <nav className="public-mobile-menu-content" aria-label="公開網站行動導覽">
              {normalizedQuery ? (
                <>
                  <p className="public-mobile-menu-result-count" role="status">
                    {searchResults.length} 項結果
                  </p>
                  <div className="public-mobile-menu-links">{searchResults.map(renderMobileLink)}</div>
                  {searchResults.length === 0 && (
                    <p className="public-nav-empty">找不到相符頁面，換個關鍵字試試。</p>
                  )}
                </>
              ) : (
                <>
                  <div className="public-mobile-menu-links is-primary">{primaryLinks.map(renderMobileLink)}</div>
                  {menuGroups.map((group) => (
                    <div key={group.id} className="public-mobile-menu-group">
                      <p className="public-mobile-group-label">{group.label}</p>
                      <div className="public-mobile-menu-links">{group.items.map(renderMobileLink)}</div>
                    </div>
                  ))}
                </>
              )}
            </nav>
            <div className="public-mobile-menu-footer">
              <Link href={systemHref} className="public-system-button" onClick={() => setOpen(false)}>
                <LogIn size={15} aria-hidden />
                {systemLabel}
              </Link>
            </div>
          </div>
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
