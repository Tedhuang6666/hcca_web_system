"use client";

/**
 * Admin impersonation banner.
 *
 * 持續顯示在頁面頂端、清楚提示「你正在以 XXX 身分檢視」。
 * 點「結束模擬」呼叫 /admin/impersonate/end 撤銷 token、重新整理。
 *
 * 用法：把 banner mount 在 root layout，內部判斷有無 impersonation token 才渲染。
 */

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "hcca_impersonation";

interface ImpersonationCtx {
  token: string;
  target_user_id: string;
  target_email: string;
  expires_at: number; // unix epoch ms
}

function readCtx(): ImpersonationCtx | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const ctx = JSON.parse(raw) as ImpersonationCtx;
    if (ctx.expires_at < Date.now()) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return ctx;
  } catch {
    return null;
  }
}

export function ImpersonationBanner() {
  const [ctx, setCtx] = useState<ImpersonationCtx | null>(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    setCtx(readCtx());
    const onStorage = () => setCtx(readCtx());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const end = useCallback(async () => {
    if (!ctx || ending) return;
    setEnding(true);
    try {
      await fetch("/api/admin/impersonate/end", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: ctx.token, reason: "user_click" }),
      });
    } catch {
      // 結束失敗也不阻擋
    } finally {
      window.sessionStorage.removeItem(STORAGE_KEY);
      setCtx(null);
      window.location.reload();
    }
  }, [ctx, ending]);

  if (!ctx) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-orange-500 px-4 py-2 text-white shadow"
    >
      <div className="flex items-center gap-2 text-sm">
        <span aria-hidden>⚠️</span>
        <span>
          你正在以 <strong>{ctx.target_email}</strong> 身分檢視（read-only）
        </span>
      </div>
      <button
        type="button"
        onClick={end}
        disabled={ending}
        className="rounded bg-white px-3 py-1 text-sm font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-60"
      >
        {ending ? "結束中…" : "結束模擬"}
      </button>
    </div>
  );
}
