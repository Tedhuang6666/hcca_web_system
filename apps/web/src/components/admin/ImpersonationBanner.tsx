"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { authApi, impersonationApi } from "@/lib/api";
import {
  AUTH_CACHE_EVENT,
  cacheCurrentUser,
  clearImpersonationSession,
  getImpersonationSession,
  IMPERSONATION_EVENT,
  type ImpersonationSession,
} from "@/lib/auth-cache";

export function ImpersonationBanner() {
  const router = useRouter();
  const [session, setSession] = useState<ImpersonationSession | null>(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    const sync = () => setSession(getImpersonationSession());
    sync();
    window.addEventListener(IMPERSONATION_EVENT, sync);
    window.addEventListener(AUTH_CACHE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(IMPERSONATION_EVENT, sync);
      window.removeEventListener(AUTH_CACHE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const end = useCallback(async () => {
    if (!session || ending) return;
    setEnding(true);
    try {
      await impersonationApi.end(session.token, "user_click");
      clearImpersonationSession();
      const me = await authApi.me();
      cacheCurrentUser(me);
    } catch {
      // token 過期或網路短暫失敗時，仍清除本機代行狀態，避免繼續誤操作。
    } finally {
      clearImpersonationSession();
      setSession(null);
      router.replace("/");
      router.refresh();
    }
  }, [ending, router, session]);

  if (!session) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-orange-500 px-4 py-2 text-white shadow"
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span aria-hidden>⚠️</span>
        <span className="truncate">
          目前以 <strong>{session.target_display_name || session.target_email}</strong> 身分
          {session.read_only ? "唯讀檢視" : "操作"}；
          由 <strong>{session.actor_display_name || session.actor_email}</strong> 管理員代行
        </span>
      </div>
      <button
        type="button"
        onClick={end}
        disabled={ending}
        className="shrink-0 rounded bg-white px-3 py-1 text-sm font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-60"
      >
        {ending ? "結束中…" : "結束代行"}
      </button>
    </div>
  );
}
