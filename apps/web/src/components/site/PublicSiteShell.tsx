"use client";

import Link from "next/link";
import { LogIn, Menu, Moon, Sun } from "lucide-react";
import { useState } from "react";

import { useTheme } from "@/components/providers/ThemeProvider";
import { BRANDING } from "@/lib/branding";
import type { PublicSitePageOut } from "@/lib/types";

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
}: {
  children: React.ReactNode;
  navPages?: PublicSitePageOut[];
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
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--bg-elevated)] focus:px-3 focus:py-2">
        跳到主要內容
      </a>
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-base)_88%,transparent)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="min-w-0 text-sm font-semibold text-[var(--text-primary)]">
            <span className="block truncate">{BRANDING.orgShortName}</span>
            <span className="block text-xs font-normal text-[var(--text-muted)]">{BRANDING.acronym}</span>
          </Link>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="公開網站導覽">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="topbar-icon-btn"
              aria-label={theme === "dark" ? "切換淺色模式" : "切換深色模式"}>
              {theme === "dark" ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
            </button>
            <Link href="/dashboard" className="btn btn-primary hidden sm:inline-flex">
              <LogIn size={15} aria-hidden />
              進入系統
            </Link>
            <button
              type="button"
              className="topbar-icon-btn lg:hidden"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls="public-mobile-nav"
              aria-label="開啟導覽">
              <Menu size={20} aria-hidden />
            </button>
          </div>
        </div>
        {open && (
          <nav
            id="public-mobile-nav"
            className="border-t border-[var(--border)] px-4 py-3 lg:hidden"
            aria-label="公開網站行動導覽">
            <div className="grid gap-2">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="min-h-11 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
                  {item.label}
                </Link>
              ))}
              <Link href="/dashboard" className="btn btn-primary mt-1">
                <LogIn size={15} aria-hidden />
                進入系統
              </Link>
            </div>
          </nav>
        )}
      </header>
      <main id="main-content">{children}</main>
      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-[var(--text-muted)] sm:px-6 md:flex-row md:items-center md:justify-between">
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
