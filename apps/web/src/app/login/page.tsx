"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import BrandEmblem from "@/components/brand/BrandEmblem";
import { BRANDING } from "@/lib/branding";
import { apiUrl } from "@/lib/config";
import { loginWithPasskey } from "@/lib/passkeys";

const FEATURES = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="12" y2="17" />
      </svg>
    ),
    title: "公文管理",
    desc: "多層級簽核、字號生成、版本追蹤",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
    title: "法規維護",
    desc: "結構化條文、版本管理、全文搜尋",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    title: "組織管理",
    desc: "RBAC 時間任期、職位、權限分配",
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
    title: "數位治理",
    desc: "問卷、學餐、訂購一站整合",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const [mounted, setMounted] = useState(false);
  const [loginHref, setLoginHref] = useState(apiUrl("/auth/google/login"));
  const [email, setEmail] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  useEffect(() => {
    setMounted(true);
    const frontendOrigin = encodeURIComponent(window.location.origin);
    const next = searchParams.get("next");
    const nextParam = next ? `&next=${encodeURIComponent(next)}` : "";
    setLoginHref(apiUrl(`/auth/google/login?frontend_origin=${frontendOrigin}${nextParam}`));
    if (localStorage.getItem("user_id")) {
      window.location.replace("/");
    }
  }, [searchParams]);

  if (!mounted) return null;

  const handlePasskeyLogin = async () => {
    if (!email.trim()) {
      toast.error("請先輸入 Email");
      return;
    }
    setPasskeyBusy(true);
    try {
      const result = await loginWithPasskey(email.trim());
      localStorage.setItem("user_id", result.user.id);
      localStorage.setItem("user_name", result.user.display_name);
      localStorage.setItem("user_email", result.user.email);
      if (result.user.avatar_url) localStorage.setItem("user_avatar", result.user.avatar_url);
      localStorage.setItem("permissions", JSON.stringify(result.user.permissions ?? []));
      localStorage.setItem("is_superuser", String(Boolean(result.user.is_superuser)));
      router.replace(searchParams.get("next") || result.next || "/");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Passkey 登入失敗");
    } finally {
      setPasskeyBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ background: "var(--bg-base)" }}>
      <Link
        href="/"
        className="fixed right-4 top-4 z-10 inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          color: "var(--text-secondary)",
          boxShadow: "var(--shadow-sm)",
          textDecoration: "none",
        }}
        aria-label="關閉登入頁面並回到主頁">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        <span className="hidden sm:inline">回主頁</span>
      </Link>

      {/* ── 左側品牌牆（桌機顯示）────────────────────────────────────────── */}
      <div
        className="hidden lg:flex flex-col justify-between w-[480px] flex-shrink-0 p-12"
        style={{
          background: "var(--primary)",
          color: "#fff",
        }}>

        <div>
          <div className="flex items-center gap-3 mb-12">
            <BrandEmblem size={44} />
            <div>
              <p className="text-base font-semibold leading-tight">{BRANDING.orgShortName}</p>
              <p className="text-xs mt-0.5 opacity-70">{BRANDING.englishName}</p>
            </div>
          </div>

          <h2 className="text-3xl font-bold leading-tight mb-4">
            {BRANDING.slogan}
          </h2>
          <p className="text-base opacity-80 leading-relaxed">
            {BRANDING.description}
          </p>

          <div className="mt-10 space-y-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex items-start gap-4">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: "rgba(255,255,255,0.15)" }}>
                  {f.icon}
                </div>
                <div>
                  <p className="text-sm font-semibold">{f.title}</p>
                  <p className="text-xs opacity-70 mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs opacity-50">
          © 2026 {BRANDING.orgName} · v0.3.0
        </p>
      </div>

      {/* ── 右側登入區域 ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8">
        <main className="w-full max-w-sm animate-slide-in">

          {/* 行動版 Logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <BrandEmblem size={40} framed priority />
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{BRANDING.orgShortName}</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{BRANDING.englishName}</p>
            </div>
          </div>

          {/* 卡片 */}
          <div
            className="rounded-2xl p-8"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow-lg)",
            }}>

            <div className="mb-6">
              <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                歡迎回來
              </h1>
              <p className="text-sm mt-1.5" style={{ color: "var(--text-muted)" }}>
                請使用竹中 Google Workspace 帳號或核准白名單登入
              </p>
            </div>

            {/* 錯誤訊息 */}
            {error && (
              <div
                className="mb-5 px-4 py-3 rounded-lg text-sm flex items-start gap-2.5"
                style={{
                  background: "var(--danger-dim)",
                  border: "1px solid var(--danger-border)",
                  color: "var(--danger)",
                }}
                role="alert"
                aria-live="assertive">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 mt-0.5" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{decodeURIComponent(error)}</span>
              </div>
            )}

            {/* Google 登入按鈕 */}
            <a
              href={loginHref}
              className="flex items-center justify-center gap-3 w-full h-11 px-5 rounded-lg font-medium text-sm transition-all cursor-pointer"
              style={{
                background: "#FFFFFF",
                color: "#1E293B",
                border: "1px solid #E2E8F0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                textDecoration: "none",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = "0 4px 8px rgba(0,0,0,0.12)";
                e.currentTarget.style.borderColor = "#CBD5E1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
                e.currentTarget.style.borderColor = "#E2E8F0";
              }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              使用 Google 帳號登入
            </a>

            <p className="text-center text-xs leading-relaxed mt-5" style={{ color: "var(--text-disabled)" }}>
              竹中成員依職位取得功能；白名單帳號由系統管理員核准<br />
              登入即表示同意相關使用規範
            </p>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1" style={{ background: "var(--border)" }} />
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>或</span>
              <div className="h-px flex-1" style={{ background: "var(--border)" }} />
            </div>

            <label className="block space-y-2">
              <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                Passkey Email
              </span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary mt-3 w-full"
              disabled={passkeyBusy}
              onClick={handlePasskeyLogin}
            >
              使用 Passkey 登入
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
