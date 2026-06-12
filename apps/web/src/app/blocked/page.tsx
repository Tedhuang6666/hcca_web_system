"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock, LogOut, ShieldBan } from "lucide-react";

import BrandEmblem from "@/components/brand/BrandEmblem";

function BlockedContent() {
  const router = useRouter();
  const params = useSearchParams();
  const reason = params.get("reason") || "未提供原因";
  const until = Number(params.get("until") || 0) || null;
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const response = await fetch("/api/system/access-status", {
          credentials: "include",
          cache: "no-store",
        });
        if (response.ok && !(await response.json()).blocked) router.replace("/");
      } catch {
        // 封鎖頁在網路異常時維持原狀。
      }
    }, 30_000);
    return () => clearInterval(timer);
  }, [router]);

  const logout = async () => {
    setChecking(true);
    try {
      const csrf = document.cookie
        .split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith("csrf_token="))
        ?.slice("csrf_token=".length);
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: csrf ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {},
      });
    } finally {
      localStorage.clear();
      window.location.href = "/login";
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg-base)] px-5 py-6 text-[var(--text-primary)]">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-4xl flex-col">
        <header className="flex items-center gap-3">
          <BrandEmblem size={42} framed priority />
          <div>
            <div className="text-sm font-semibold">校園自治平台</div>
            <div className="text-xs text-[var(--text-muted)]">Access Restricted</div>
          </div>
        </header>

        <section className="my-auto py-12">
          <div className="max-w-2xl rounded-xl border border-[var(--danger-border)] bg-[var(--bg-surface)] p-6 shadow-sm md:p-9">
            <div className="mb-5 grid h-14 w-14 place-items-center rounded-lg bg-[var(--danger-dim)] text-[var(--danger)]">
              <ShieldBan size={28} aria-hidden />
            </div>
            <h1 className="text-3xl font-semibold">你已被此網站封鎖</h1>
            <p className="mt-3 leading-7 text-[var(--text-secondary)]">
              目前無法使用本平台。若你認為這是誤判，請聯絡平台管理員並提供帳號信箱與發生時間。
            </p>

            <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--bg-hover)] p-4">
              <div className="text-xs font-medium text-[var(--text-muted)]">封鎖原因</div>
              <div className="mt-1 whitespace-pre-wrap text-sm font-medium">{reason}</div>
              <div className="mt-4 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <Clock size={15} aria-hidden />
                {until ? `預計解除：${new Date(until * 1000).toLocaleString()}` : "封鎖期限：永久"}
              </div>
            </div>

            <button
              type="button"
              onClick={logout}
              disabled={checking}
              className="btn btn-ghost mt-6"
            >
              <LogOut size={16} aria-hidden />
              {checking ? "登出中" : "登出帳號"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function BlockedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg-base)]" />}>
      <BlockedContent />
    </Suspense>
  );
}
