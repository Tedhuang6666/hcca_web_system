import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

import BrandEmblem from "@/components/brand/BrandEmblem";
import { BRANDING } from "@/lib/branding";
import { apiUrl, safeInternalHref } from "@/lib/config";

import LoginClientEffects from "./LoginClientEffects";
import PasskeyLogin from "./PasskeyLogin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "登入",
  robots: {
    index: false,
    follow: false,
  },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function decodeError(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function requestOrigin(requestHeaders: Headers): string {
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || requestHeaders.get("host") || `www.${BRANDING.domain}`;
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const protocol = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${protocol}://${host}`;
}

function oauthLoginHref(provider: "google" | "discord", next: string, origin: string): string {
  const params = new URLSearchParams({ frontend_origin: origin, next });
  return apiUrl(`/auth/${provider}/login?${params.toString()}`);
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const nextPath = safeInternalHref(firstParam(params.next), "/dashboard");
  const error = decodeError(firstParam(params.error));
  const origin = requestOrigin(await headers());
  const googleLoginHref = oauthLoginHref("google", nextPath, origin);
  const discordLoginHref = oauthLoginHref("discord", nextPath, origin);

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      <LoginClientEffects nextPath={nextPath} />

      <Link
        href="/"
        className="fixed right-4 top-4 z-20 inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors hover:bg-[var(--bg-surface)] sm:right-6 sm:top-6"
        style={{
          background: "color-mix(in srgb, var(--bg-surface) 92%, transparent)",
          border: "1px solid var(--border-strong)",
          color: "var(--text-secondary)",
          textDecoration: "none",
        }}
        aria-label="離開登入頁並回到首頁"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        <span>回到首頁</span>
      </Link>

      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.12fr)_minmax(440px,0.88fr)]">
        <section
          className="login-aside relative hidden overflow-hidden px-12 py-10 lg:flex lg:flex-col lg:justify-between xl:px-20 xl:py-14"
          style={{
            background: "color-mix(in srgb, var(--bg-surface) 86%, var(--primary-dim))",
            borderRight: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <header className="relative z-10 flex items-center gap-3">
            <BrandEmblem size={46} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {BRANDING.orgShortName}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                {BRANDING.acronym}
              </p>
            </div>
          </header>

          <div className="login-brand-stage relative z-10 flex w-full flex-col items-center py-16 text-center">
            <BrandEmblem size={172} />
            <p className="mt-8 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
              校園自治整合平台
            </p>
            <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
              公文、會議與校園服務
            </p>
          </div>

          <footer className="relative z-10 text-[11px]" style={{ color: "var(--text-muted)" }}>
            <span>© {new Date().getFullYear()} {BRANDING.orgName}</span>
          </footer>
        </section>

        <section
          className="relative flex min-h-screen items-center justify-center px-5 py-24 sm:px-10 lg:py-16"
          style={{ background: "var(--bg-base)" }}
        >
          <main className="relative z-10 w-full max-w-md text-center">
            <div className="mb-12 flex items-center justify-center gap-3 text-center lg:hidden">
              <BrandEmblem size={44} priority />
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {BRANDING.orgShortName}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  {BRANDING.platformName}
                </p>
              </div>
            </div>

            <div className="mb-8">
              <h1
                className="text-3xl font-semibold tracking-[-0.025em] sm:text-4xl"
                style={{ color: "var(--text-primary)" }}
              >
                登入管理系統
              </h1>
              <p className="mt-3 text-sm leading-6" style={{ color: "var(--text-muted)" }}>
                請先使用 Google 帳戶登入；已完成綁定者可改用 Discord。
              </p>
            </div>

            {error && (
              <div
                className="mb-5 flex items-start gap-2.5 rounded-xl px-4 py-3 text-left text-sm"
                style={{
                  background: "var(--danger-dim)",
                  border: "1px solid var(--danger-border)",
                  color: "var(--danger)",
                }}
                role="alert"
                aria-live="assertive"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="mt-0.5 flex-shrink-0"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <a
              href={googleLoginHref}
              data-no-prefetch="true"
              data-full-navigation="true"
              className="login-oauth group flex h-13 w-full cursor-pointer items-center justify-between rounded-xl px-4 text-sm font-semibold transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                background: "var(--primary)",
                color: "var(--primary-fg)",
                border: "1px solid var(--primary)",
                textDecoration: "none",
              }}
            >
              <span className="flex items-center gap-3">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                使用 Google 帳戶登入
              </span>
              <ArrowRight
                size={17}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </a>

            <div className="my-7 flex items-center gap-4">
              <div className="h-px flex-1" style={{ background: "var(--border)" }} />
              <span className="text-[11px] tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
                已綁定帳號才使用
              </span>
              <div className="h-px flex-1" style={{ background: "var(--border)" }} />
            </div>

            <a
              href={discordLoginHref}
              data-no-prefetch="true"
              data-full-navigation="true"
              className="login-oauth group flex h-13 w-full cursor-pointer items-center justify-between rounded-xl px-4 text-sm font-semibold transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-strong)",
                textDecoration: "none",
              }}
            >
              <span className="flex items-center gap-3">
                <svg width="20" height="16" viewBox="0 0 24 18" fill="currentColor" aria-hidden="true">
                  <path d="M20.3 1.5A18.4 18.4 0 0 0 15.8.1l-.6 1.2a16.8 16.8 0 0 0-6.4 0L8.2.1a18.7 18.7 0 0 0-4.5 1.4C.9 5.6.1 9.6.5 13.5a18.2 18.2 0 0 0 5.6 2.8l1.4-1.9a11.8 11.8 0 0 1-2.1-1l.5-.4a13.1 13.1 0 0 0 12.2 0l.5.4a13 13 0 0 1-2.1 1l1.4 1.9a18.2 18.2 0 0 0 5.6-2.8c.5-4.5-.8-8.5-3.2-12ZM8.2 11.1c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Zm7.6 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Z" />
                </svg>
                使用已綁定的 Discord 登入
              </span>
              <ArrowRight
                size={17}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </a>
            <p className="mt-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              尚未綁定帳號時，請改用 Google 登入。
            </p>

            <PasskeyLogin nextPath={nextPath} />

            <p className="mt-8 text-center text-xs leading-6" style={{ color: "var(--text-muted)" }}>
              登入即表示你同意
              <Link
                className="mx-1 inline-flex min-h-11 items-center underline underline-offset-4 hover:text-[var(--text-primary)]"
                href="/legal/terms"
              >
                服務條款
              </Link>
              與
              <Link
                className="ml-1 inline-flex min-h-11 items-center underline underline-offset-4 hover:text-[var(--text-primary)]"
                href="/legal/privacy"
              >
                隱私權政策
              </Link>
            </p>
          </main>
        </section>
      </div>
    </div>
  );
}
