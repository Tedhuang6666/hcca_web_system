"use client";

import Link from "next/link";
import { LogIn, Menu, Moon, Sun, X } from "lucide-react";
import { useState } from "react";

import { useTheme } from "@/components/providers/ThemeProvider";
import { BRANDING } from "@/lib/branding";
import type { PublicSitePageOut, PublicSiteSettingsOut } from "@/lib/types";

const BASE_NAV = [
  { href: "/", label: "首頁" },
  { href: "/about", label: "關於班聯會" },
  { href: "/news", label: "最新公告" },
  { href: "/officers", label: "班聯會幹部" },
  { href: "/links", label: "平台連結" },
  { href: "/public", label: "公開資料庫" },
];

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
  const { theme, toggleTheme } = useTheme();
  const nav = [
    ...BASE_NAV,
    ...navPages.map((page) => ({
      href: `/pages/${page.slug}`,
      label: page.nav_label || page.title,
    })),
  ];

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
      <header className="public-header">
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
                "竹"
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
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="public-nav-link">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="public-header-actions">
            <button
              type="button"
              onClick={toggleTheme}
              className="public-icon-button"
              aria-label={theme === "dark" ? "切換淺色模式" : "切換深色模式"}>
              {theme === "dark" ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
            </button>
            <Link href="/dashboard" className="public-system-button hidden sm:inline-flex">
              <LogIn size={15} aria-hidden />
              進入系統
            </Link>
            <button
              type="button"
              className="public-menu-button"
              onClick={() => setOpen((value) => !value)}
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
            <div className="mb-3 px-1 text-xs font-semibold uppercase text-[var(--public-muted)]">
              HCCA Navigation
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="public-mobile-link">
                  {item.label}
                </Link>
              ))}
              <Link href="/dashboard" className="public-system-button mt-1 sm:col-span-2">
                <LogIn size={15} aria-hidden />
                進入系統
              </Link>
            </div>
          </nav>
        )}
      </header>
      <main id="main-content">{children}</main>
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
