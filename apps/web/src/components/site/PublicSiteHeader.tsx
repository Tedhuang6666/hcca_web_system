"use client";

import Link from "@/components/ui/IntentLink";
import { ChevronDown, LogIn, Menu, Moon, Search, Sun, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { usePublicModuleStatus } from "@/contexts/PublicModuleStatusContext";
import { useTheme } from "@/components/providers/ThemeProvider";
import ImportantAnnouncementBanner, {
  type ImportantAnnouncement,
} from "@/components/site/ImportantAnnouncementBanner";
import PublicEmblem from "@/components/site/PublicEmblem";
import PublicNavIcon from "@/components/site/PublicNavIcon";
import LocationMark, { useLocationMarkScope } from "@/components/ui/LocationMark";
import { BRANDING } from "@/lib/branding";
import { coverRadius, MOTION_EASE_IN, MOTION_EASE_OUT, shouldReduceMotion } from "@/lib/motion";
import {
  PUBLIC_NAV_GROUP_META,
  type ResolvedNavItem,
  type PublicNavGroupId,
  groupResolvedNav,
  publicPageHref,
  resolvePublicNav,
} from "@/lib/publicNav";
import type { PublicSitePageOut, PublicSiteSettingsOut } from "@/lib/types";

const MENU_GROUP_ORDER: PublicNavGroupId[] = ["primary", "info", "data", "participation"];
const DeferredLiveElectionBanner = lazy(() => import("@/components/site/LiveElectionBanner"));
const NAV_MARK_GROUP = "public-site-nav";

/** 選單從選單鈕的位置展開（及收回），與深淺色切換同一種「從觸發點擴散」的語彙。 */
function menuClipFrames(menu: HTMLElement, button: HTMLElement | null) {
  const buttonRect = button?.getBoundingClientRect();
  if (!buttonRect || buttonRect.width === 0) return null;
  const menuRect = menu.getBoundingClientRect();
  const x = buttonRect.left + buttonRect.width / 2;
  const y = buttonRect.top + buttonRect.height / 2;
  const at = `at ${x - menuRect.left}px ${y - menuRect.top}px`;
  return [`circle(0px ${at})`, `circle(${coverRadius(menuRect, x, y)}px ${at})`];
}

type PublicHeaderSettings = Pick<
  PublicSiteSettingsOut,
  "site_logo_url" | "site_logo_alt" | "theme_config"
>;
type PublicHeaderNavPage = Pick<PublicSitePageOut, "id" | "slug" | "title" | "nav_label" | "page_kind">;

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
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const mobileBackdropRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const moduleStatusReady = Object.keys(statuses).length > 0;
  useLocationMarkScope(NAV_MARK_GROUP);

  // 收合動畫結束後才卸載選單；減少動態或量不到按鈕位置時直接關閉。
  const closeMobileMenu = useCallback(() => {
    const menu = mobileNavRef.current;
    const finish = () => {
      setOpen(false);
      if (menuButtonRef.current?.isConnected) menuButtonRef.current.focus();
    };
    if (!menu) {
      finish();
      return;
    }
    if (menu.dataset.closing === "true") return;
    const frames = shouldReduceMotion() ? null : menuClipFrames(menu, menuButtonRef.current);
    if (!frames) {
      finish();
      return;
    }
    menu.dataset.closing = "true";
    const timing = { duration: 240, easing: MOTION_EASE_IN, fill: "forwards" as const };
    mobileBackdropRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], timing);
    menu.animate({ clipPath: [...frames].reverse() }, timing).finished.then(finish, finish);
  }, []);

  useLayoutEffect(() => {
    const menu = mobileNavRef.current;
    if (!open || !menu || shouldReduceMotion()) return;
    const frames = menuClipFrames(menu, menuButtonRef.current);
    if (!frames) return;
    const reveal = menu.animate({ clipPath: frames }, { duration: 420, easing: MOTION_EASE_OUT });
    return () => reveal.cancel();
  }, [open]);
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
        closeMobileMenu();
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
    const desktopMedia = window.matchMedia("(min-width: 768px)");
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
  }, [closeMobileMenu, open]);

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
  const publicDataSlot = itemByKey.has("shop")
    ? ["shop", "商品訂購"]
    : ["public-db", "公開資料"];
  const articleNavItem = itemByKey.get("articles");
  const taskNav: ResolvedNavItem[] = [
    ...(articleNavItem ? [articleNavItem] : []),
    ...[
      ["news", "最新公告"],
      publicDataSlot,
      ["surveys", "問卷調查"],
    ].flatMap(([key, label]) => {
      const item = itemByKey.get(key);
      return item ? [{ ...item, label }] : [];
    }),
  ];
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
  const filteredTaskNav = taskNav.filter(matchesServiceQuery);
  const filteredNavPages = navPages.filter((page) => matchesServiceQuery({
    label: page.nav_label || page.title,
    description: page.title,
  }));
  const filteredArticlePages = filteredNavPages.filter((page) => page.page_kind === "article");
  const filteredOtherPages = filteredNavPages.filter((page) => page.page_kind !== "article");
  const serviceResultCount = filteredTaskNav.length
    + filteredMenuGroups.reduce((count, group) => count + group.items.length, 0)
    + filteredNavPages.length;
  const mobileResults = [
    ...filteredTaskNav,
    ...filteredMenuGroups.flatMap((group) => group.items),
    ...filteredNavPages.map((page) => ({
      key: `page:${page.id}`,
      href: publicPageHref(page),
      label: page.nav_label || page.title,
      iconKey: page.page_kind === "article" ? "articles" : "links",
    })),
  ];
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
          {taskNav.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`public-nav-link public-task-nav-link${item.key === "shop" ? " public-shop-nav-link" : ""}${item.key === "articles" ? " public-articles-nav-link" : ""}`}
              aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined}
            >
              {item.label}
              {isCurrentPath(pathname, item.href) && (
                <LocationMark group={NAV_MARK_GROUP} className="public-nav-mark" />
              )}
            </Link>
          ))}
          {menuGroups.length > 0 && (
            <details
              className="public-nav-dropdown"
              ref={menuRef}
              onToggle={(event) => {
                const dropdown = event.currentTarget as HTMLDetailsElement;
                if (dropdown.open) setOpen(false);
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
                {normalizedQuery && filteredTaskNav.length > 0 && (
                  <section className="public-nav-dropdown-quick">
                    <p className="public-nav-dropdown-label">快速入口</p>
                    <div className="public-nav-dropdown-quick-links">
                      {filteredTaskNav.map((item) => (
                        <Link
                          key={item.key}
                          href={item.href}
                          className="public-nav-dropdown-link public-nav-dropdown-quick-link"
                          aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined}
                        >
                          <span className="public-nav-dropdown-icon" aria-hidden="true">
                            <PublicNavIcon iconKey={item.iconKey} size={18} />
                          </span>
                          <span className="min-w-0 text-sm font-semibold">{item.label}</span>
                        </Link>
                      ))}
                    </div>
                  </section>
                )}
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
                          <span className="min-w-0 text-sm font-semibold">{item.label}</span>
                        </Link>
                      ))}
                    </div>
                  </section>
                ))}
                {filteredArticlePages.length > 0 && (
                  <section>
                    <p className="public-nav-dropdown-label">文章專欄</p>
                    <div className="grid gap-0.5">
                      {filteredArticlePages.map((page) => (
                        <Link
                          key={page.id}
                          href={publicPageHref(page)}
                          className="public-nav-dropdown-link"
                          aria-current={isCurrentPath(pathname, publicPageHref(page)) ? "page" : undefined}
                        >
                          <span className="min-w-0 text-sm font-semibold">{page.nav_label || page.title}</span>
                        </Link>
                      ))}
                    </div>
                  </section>
                )}
                {filteredOtherPages.length > 0 && (
                  <section>
                    <p className="public-nav-dropdown-label">其他公開頁面</p>
                    <div className="grid gap-0.5">
                      {filteredOtherPages.map((page) => (
                        <Link
                          key={page.id}
                          href={publicPageHref(page)}
                          className="public-nav-dropdown-link"
                          aria-current={isCurrentPath(pathname, publicPageHref(page)) ? "page" : undefined}
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
            ref={mobileBackdropRef}
            type="button"
            className="public-mobile-backdrop"
            aria-label="關閉導覽"
            onClick={closeMobileMenu}
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
                onClick={closeMobileMenu}
              >
                <X size={20} aria-hidden />
              </button>
              <label className="public-mobile-service-search">
                <Search size={18} aria-hidden />
                <span className="sr-only">搜尋所有公開服務</span>
                <input
                  type="search"
                  value={serviceQuery}
                  onChange={(event) => setServiceQuery(event.target.value)}
                  placeholder="搜尋頁面"
                />
              </label>
            </div>
            <nav className="public-mobile-menu-content" aria-label="公開網站行動導覽">
              {normalizedQuery && (
                <p className="public-mobile-menu-result-count" role="status">
                  {serviceResultCount} 項結果
                </p>
              )}
              <div className="public-mobile-menu-links">
                {mobileResults.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="public-mobile-service-link"
                    aria-current={isCurrentPath(pathname, item.href) ? "page" : undefined}
                  >
                    <span className="public-nav-dropdown-icon" aria-hidden="true">
                      <PublicNavIcon iconKey={item.iconKey} size={16} />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
              {normalizedQuery && serviceResultCount === 0 && (
                <p className="public-nav-empty">找不到相符服務；請改用其他關鍵字。</p>
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
