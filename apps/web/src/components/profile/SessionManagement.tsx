"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { usersApi, apiErrorMessage } from "@/lib/api";
import { clearAuthCache } from "@/lib/auth-cache";
import type { SecurityEventRead, UserSessionRead } from "@/lib/types";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function SessionManagement() {
  const [sessions, setSessions] = useState<UserSessionRead[]>([]);
  const [events, setEvents] = useState<SecurityEventRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"others" | "all" | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [eventError, setEventError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setSessionError("");
    setEventError("");
    const [sessionResult, eventResult] = await Promise.allSettled([
      usersApi.mySessions(),
      usersApi.securityEvents(),
    ]);

    if (sessionResult.status === "fulfilled") {
      setSessions(sessionResult.value);
    } else {
      setSessionError(apiErrorMessage(sessionResult.reason, "無法載入登入工作階段"));
    }
    if (eventResult.status === "fulfilled") {
      setEvents(eventResult.value);
    } else {
      setEventError(apiErrorMessage(eventResult.reason, "無法載入安全活動"));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revokeOthers() {
    setBusy("others");
    try {
      const result = await usersApi.revokeOtherSessions();
      toast.success(`已登出 ${result.revoked_count} 個其他工作階段`);
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, "登出其他裝置失敗"));
    } finally {
      setBusy(null);
    }
  }

  async function revokeAll() {
    if (!window.confirm("這會登出所有裝置，並需要重新登入。確定要繼續嗎？")) return;
    setBusy("all");
    try {
      await usersApi.revokeAllSessions();
      clearAuthCache();
      window.location.replace("/login?reason=signed_out");
    } catch (error) {
      toast.error(apiErrorMessage(error, "登出全部裝置失敗"));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="card p-5 space-y-4" aria-labelledby="sessions-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="sessions-heading" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              登入裝置與工作階段
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              檢視仍有效的登入，發現陌生裝置時可立即撤銷。
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost text-xs" onClick={() => void revokeOthers()} disabled={busy !== null || loading}>
              {busy === "others" ? "處理中…" : "登出其他裝置"}
            </button>
            <button type="button" className="btn btn-danger text-xs" onClick={() => void revokeAll()} disabled={busy !== null || loading}>
              {busy === "all" ? "處理中…" : "登出全部裝置"}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>載入工作階段中…</p>
        ) : sessionError ? (
          <div className="rounded-md border p-3" style={{ borderColor: "var(--danger)", color: "var(--danger)" }} role="alert">
            <p className="text-sm">{sessionError}</p>
            <button type="button" className="btn btn-ghost mt-2 text-xs" onClick={() => void load()}>重新載入</button>
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>目前沒有可顯示的有效工作階段。</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }} aria-label="有效登入工作階段">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {session.device_label}
                    {session.is_current && (
                      <span className="ml-2 rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                        目前裝置
                      </span>
                    )}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {session.ip_address ?? "未知 IP"} · 最近活動 {formatDate(session.last_seen_at)}
                  </p>
                </div>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  建立於 {formatDate(session.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5 space-y-3" aria-labelledby="security-events-heading">
        <div>
          <h2 id="security-events-heading" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            最近安全活動
          </h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>僅顯示與本人帳號維護相關的最近紀錄。</p>
        </div>
        {eventError ? (
          <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">{eventError}</p>
        ) : events.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>目前沒有安全活動紀錄。</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }} aria-label="最近安全活動">
            {events.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm" style={{ color: "var(--text-primary)" }}>{event.summary ?? event.action}</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{event.action}</p>
                </div>
                <time className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }} dateTime={event.created_at}>
                  {formatDate(event.created_at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
