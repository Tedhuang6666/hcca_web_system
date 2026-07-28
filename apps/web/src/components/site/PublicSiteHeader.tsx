"use client";

import Link from "next/link";
import { ChevronDown, LogIn, Menu, Moon, Sun, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import { useTheme } from "@/components/providers/ThemeProvider";
import ImportantAnnouncementBanner from "@/components/site/ImportantAnnouncementBanner";
import LiveElectionBanner from "@/components/site/LiveElectionBanner";
import PublicEmblem from "@/components/site/PublicEmblem";
import { BRANDING } from "@/lib/branding";
import {
  PUBLIC_NAV_GROUP_META,
  type PublicNavGroupId,
  groupResolvedNav,
  resolvePublicNav,
} from "@/lib/publicNav";
import type { AnnouncementOut, PublicSitePageOut, PublicSiteSettingsOut } from "@/lib/types";

const MENU_GROUP_ORDER: PublicNavGroupId[] = ["info", "data", "participation"];

function PublicSiteHeaderContent({
  navPages,
  settings,
  urgentAnnouncement,
}: {
  navPages: PublicSitePageOut[];
  settings?: PublicSiteSettingsOut | null;
  urgentAnnouncement?: AnnouncementOut | null;
}) {
  const [open, setOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [moduleStatusReady, setModuleStatusReady] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { isModuleClosed } = useModuleStatus();
  const pathname = usePathname();
  const publicEmblemUrl = settings?.site_logo_url?.trim() || BRANDING.publicEmblemUrl;
  const menuRef = useRef<HTMLDetailsElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setOpen(false);
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

  const resolvedGroups = groupResolvedNav(
    resolvePublicNav(settings?.theme_config as Record<string, unknown> | undefined),
  );
  const groups = {
    primary: resolvedGroups.primary.filter(
      (item) => !moduleStatusReady || !isModuleClosed(item.moduleId ?? null),
    ),
    info: resolvedGroups.info.filter(
      (item) => !moduleStatusReady || !isModuleClosed(item.moduleId ?? null),
    ),
    data: resolvedGroups.data.filter(
      (item) => !moduleStatusReady || !isModuleClosed(item.moduleId ?? null),
    ),
    participation: resolvedGroups.participation.filter(
      (item) => !moduleStatusReady || !isModuleClosed(item.moduleId ?? null),
    ),
  };
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
    setModuleStatusReady(true);
  }, []);

  return (
    <header className="public-header" ref={headerRef}>
      <LiveElectionBanner />
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
          {topLevel.map((item) => (
            <Link key={item.key} href={item.href} className="public-nav-link">
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
            aria-label={theme === "dark" ? "切換淺色模式" : "切換深色模式"}
          >
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
          <nav id="public-mobile-nav" className="public-mobile-nav" aria-label="公開網站行動導覽">
            <div className="grid gap-2">
              {topLevel.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="public-mobile-link"
                >
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
        </>
      )}
    </header>
  );
}

export default function PublicSiteHeader(props: {
  navPages?: PublicSitePageOut[];
  settings?: PublicSiteSettingsOut | null;
  urgentAnnouncement?: AnnouncementOut | null;
}) {
  return (
    <PublicSiteHeaderContent
      navPages={props.navPages ?? []}
      settings={props.settings}
      urgentAnnouncement={props.urgentAnnouncement}
    />
  );
}
