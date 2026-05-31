"use client";
import { useEffect } from "react";
import Link from "next/link";

import { BRANDING } from "@/lib/branding";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center flex flex-col items-center gap-4 max-w-sm">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" className="opacity-40" style={{ color: "var(--danger)" }}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            發生錯誤
          </h2>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {BRANDING.acronym} 頁面載入時發生問題，請稍後再試。
          </p>
          {error.digest && (
            <p className="text-xs mt-2 font-mono" style={{ color: "var(--text-disabled)" }}>
              錯誤代碼：{error.digest}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={reset} className="btn btn-primary">重新嘗試</button>
          <Link href="/" className="btn" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
            返回首頁
          </Link>
        </div>
      </div>
    </div>
  );
}
