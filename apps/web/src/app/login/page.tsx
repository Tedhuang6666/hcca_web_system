"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";

import BrandEmblem from "@/components/brand/BrandEmblem";
import { BRANDING } from "@/lib/branding";
import { apiUrl } from "@/lib/config";

const GOVERNANCE_POINTS = [
  { number: "01", title: "資訊透明", description: "讓公告、法規與議事紀錄清楚可查" },
  { number: "02", title: "協作有序", description: "讓文件流轉與組織權責留下脈絡" },
  { number: "03", title: "服務整合", description: "讓校園參與和日常服務集中在同一處" },
];

export default function LoginPage() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const [mounted, setMounted] = useState(false);
  const [googleLoginHref, setGoogleLoginHref] = useState(apiUrl("/auth/google/login"));
  const [discordLoginHref, setDiscordLoginHref] = useState(apiUrl("/auth/discord/login"));

  useEffect(() => {
    setMounted(true);
    const frontendOrigin = encodeURIComponent(window.location.origin);
    const next = searchParams.get("next");
    const nextParam = next ? `&next=${encodeURIComponent(next)}` : "";
    setGoogleLoginHref(
      apiUrl(`/auth/google/login?frontend_origin=${frontendOrigin}${nextParam}`),
    );
    setDiscordLoginHref(
      apiUrl(`/auth/discord/login?frontend_origin=${frontendOrigin}${nextParam}`),
    );
    if (localStorage.getItem("user_id")) {
      window.location.replace("/");
    }
  }, [searchParams]);

  if (!mounted) return null;

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: "var(--bg-base)" }}
    >
      <Link
        href="/"
        className="fixed right-4 top-4 z-20 inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors hover:bg-[var(--bg-surface)] sm:right-6 sm:top-6"
        style={{
          background: "color-mix(in srgb, var(--bg-surface) 78%, transparent)",
          border: "1px solid var(--border-strong)",
          color: "var(--text-secondary)",
          textDecoration: "none",
          backdropFilter: "blur(14px)",
        }}
        aria-label="離開登入頁並回到首頁"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        <span>回到首頁</span>
      </Link>

      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.12fr)_minmax(440px,0.88fr)]">
        <section
          className="login-aside relative hidden overflow-hidden px-12 py-10 lg:flex lg:flex-col lg:justify-between xl:px-20 xl:py-14"
          style={{ background: "#173654", color: "#f8f3e5" }}
        >
          <div
            className="login-ring pointer-events-none absolute -left-32 bottom-[-15rem] h-[34rem] w-[34rem] rounded-full"
            style={{ border: "1px solid rgba(232, 201, 112, 0.28)" }}
          />
          <div
            className="login-ring login-ring-2 pointer-events-none absolute -left-16 bottom-[-11rem] h-[25rem] w-[25rem] rounded-full"
            style={{ border: "1px solid rgba(232, 201, 112, 0.22)" }}
          />
          <div
            className="login-orb pointer-events-none absolute right-[-7rem] top-[-8rem] h-80 w-80 rounded-full blur-3xl"
            style={{ background: "rgba(201, 168, 76, 0.2)" }}
          />

          <header className="relative z-10 flex items-center gap-3">
            <BrandEmblem size={46} priority />
            <div>
              <p className="text-sm font-semibold tracking-[0.08em]">{BRANDING.orgShortName}</p>
              <p className="mt-0.5 text-[11px] tracking-[0.14em] text-[#cdd8e0]">
                {BRANDING.englishName}
              </p>
            </div>
          </header>

          <div className="login-rise relative z-10 max-w-2xl py-16">
            <p className="mb-6 flex items-center gap-3 text-xs font-semibold tracking-[0.2em] text-[#e8c970]">
              <span className="login-rule h-px w-10 bg-[#e8c970]" />
              HCCA CAMPUS GOVERNANCE
            </p>
            <h1
              className="max-w-xl text-[2.5rem] font-semibold leading-[1.28] tracking-[-0.04em] xl:text-5xl 2xl:text-6xl"
              style={{
                color: "#f8f3e5",
                fontFamily: "\"Noto Serif TC\", serif",
              }}
            >
              <span className="block whitespace-nowrap">
                讓校園自治<span className="text-[#e8c970]">更透明，</span>
              </span>
              <span className="block whitespace-nowrap text-[#e8c970]">也更靠近每個人。</span>
            </h1>
            <p className="mt-7 max-w-lg text-base leading-8 text-[#cdd8e0]">
              從議事協作到校園服務，將制度、紀錄與參與整合在同一個可信賴的入口。
            </p>

            <div className="mt-12 grid max-w-2xl grid-cols-3 border-y border-white/15">
              {GOVERNANCE_POINTS.map((point) => (
                <div
                  key={point.number}
                  className="border-r border-white/15 py-5 pr-5 last:border-r-0 [&:not(:first-child)]:pl-5"
                >
                  <p className="text-[11px] font-semibold tracking-[0.16em] text-[#e8c970]">
                    {point.number}
                  </p>
                  <p className="mt-3 text-sm font-semibold">{point.title}</p>
                  <p className="mt-1.5 text-xs leading-5 text-[#aebeca]">{point.description}</p>
                </div>
              ))}
            </div>
          </div>

          <footer className="relative z-10 flex items-center justify-between text-[11px] text-[#91a5b5]">
            <span>© {new Date().getFullYear()} {BRANDING.orgName}</span>
            <span>竹嶺 · 班聯</span>
          </footer>
        </section>

        <section className="relative flex min-h-screen items-center justify-center px-5 py-24 sm:px-10 lg:py-16">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-70 lg:hidden"
            style={{
              background:
                "radial-gradient(circle at 20% 0%, color-mix(in srgb, var(--primary) 22%, transparent), transparent 60%)",
            }}
          />

          <main className="relative z-10 w-full max-w-md animate-slide-in">
            <div className="mb-12 flex items-center gap-3 lg:hidden">
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
              <div
                className="mb-5 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium"
                style={{
                  background: "var(--primary-dim)",
                  color: "var(--primary-text)",
                }}
              >
                <ShieldCheck size={14} aria-hidden="true" />
                安全登入
              </div>
              <h2
                className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl"
                style={{
                  color: "var(--text-primary)",
                  fontFamily: "\"Noto Serif TC\", serif",
                }}
              >
                歡迎回來
              </h2>
              <p className="mt-3 text-sm leading-6" style={{ color: "var(--text-muted)" }}>
                使用竹中 Google 帳戶，或以已綁定的 Discord 帳號繼續。
              </p>
            </div>

            {error && (
              <div
                className="mb-5 flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm"
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
                <span>{decodeURIComponent(error)}</span>
              </div>
            )}

            <a
              href={googleLoginHref}
              className="login-oauth group flex h-13 w-full cursor-pointer items-center justify-between rounded-xl px-4 text-sm font-semibold transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                background: "#ffffff",
                color: "#173654",
                border: "1px solid #d9dee3",
                boxShadow: "0 8px 24px rgba(23, 54, 84, 0.08)",
                textDecoration: "none",
              }}
            >
              <span className="flex items-center gap-3">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
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
                或使用 DISCORD
              </span>
              <div className="h-px flex-1" style={{ background: "var(--border)" }} />
            </div>

            <a
              href={discordLoginHref}
              className="login-oauth group flex h-13 w-full cursor-pointer items-center justify-between rounded-xl px-4 text-sm font-semibold text-white transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                background: "#5865f2",
                boxShadow: "0 8px 24px rgba(88, 101, 242, 0.24)",
                textDecoration: "none",
              }}
            >
              <span className="flex items-center gap-3">
                <svg width="20" height="16" viewBox="0 0 24 18" fill="currentColor" aria-hidden="true">
                  <path d="M20.3 1.5A18.4 18.4 0 0 0 15.8.1l-.6 1.2a16.8 16.8 0 0 0-6.4 0L8.2.1a18.7 18.7 0 0 0-4.5 1.4C.9 5.6.1 9.6.5 13.5a18.2 18.2 0 0 0 5.6 2.8l1.4-1.9a11.8 11.8 0 0 1-2.1-1l.5-.4a13.1 13.1 0 0 0 12.2 0l.5.4a13 13 0 0 1-2.1 1l1.4 1.9a18.2 18.2 0 0 0 5.6-2.8c.5-4.5-.8-8.5-3.2-12ZM8.2 11.1c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Zm7.6 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Z" />
                </svg>
                使用 Discord 帳號登入
              </span>
              <ArrowRight
                size={17}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </a>
            <p className="mt-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              Discord 帳號須先在個人資料完成綁定。
            </p>

            <p className="mt-8 text-center text-xs leading-6" style={{ color: "var(--text-muted)" }}>
              登入即表示你同意
              <Link
                className="mx-1 underline underline-offset-4 hover:text-[var(--text-primary)]"
                href="/legal/terms"
              >
                服務條款
              </Link>
              與
              <Link
                className="ml-1 underline underline-offset-4 hover:text-[var(--text-primary)]"
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
