"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Lock,
  LogOut,
  ShieldHalf,
  UserCog } from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import {
  authApi,
  impersonationApi,
  type ImpersonationStartResponse, apiErrorMessage } from "@/lib/api";
import { cacheCurrentUser, clearImpersonationSession, saveImpersonationSession } from "@/lib/auth-cache";

export default function ImpersonationPage() {
  const { can } = usePermissions();
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<ImpersonationStartResponse | null>(null);

  const onStart = async () => {
    const id = userId.trim();
    if (!id) {
      toast.error("請填入目標 user UUID");
      return;
    }
    if (
      !window.confirm(
        `將以該使用者身分檢視 ${minutes} 分鐘。\n` +
          `所有修改會被記為「以 ${id} 身分，由你管理員代行」。\n\n` +
          `繼續？`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await impersonationApi.start(id, minutes);
      saveImpersonationSession({
        ...r,
        expires_at: Date.now() + r.expires_in_minutes * 60_000,
      });
      cacheCurrentUser(await authApi.me());
      setActive(r);
      toast.success(`已啟動 ${r.expires_in_minutes} 分鐘代行，現在套用目標使用者視角`);
      router.replace("/");
    } catch (e) {
      toast.error(apiErrorMessage(e, "啟動失敗"));
    } finally {
      setBusy(false);
    }
  };

  const onEnd = async () => {
    if (!active) return;
    setBusy(true);
    try {
      await impersonationApi.end(active.token, "manual_end");
      clearImpersonationSession();
      cacheCurrentUser(await authApi.me());
      toast.success("已結束 impersonation（token 已撤銷）");
      setActive(null);
      router.replace("/admin/impersonation");
    } catch (e) {
      toast.error(apiErrorMessage(e, "結束失敗"));
    } finally {
      setBusy(false);
    }
  };

  if (!can("admin:impersonate")) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section
          className="rounded-lg border p-8 text-center"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
          <Lock className="mx-auto mb-3 text-[var(--danger)]" size={32} aria-hidden />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            需要超級管理員權限
          </h1>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-4 md:p-6">
      <header className="mb-5">
        <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
          <ShieldHalf size={14} aria-hidden />
          管理員代理登入
        </div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Impersonation</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
          以另一名使用者身分操作平台，權限、視角與導覽都依目標使用者套用。需要{" "}
          <code>admin:impersonate</code> 權限；所有修改會在 audit log 註明由你代行。
        </p>
      </header>

      <section
        className="mb-4 rounded-lg border bg-[var(--bg-surface)] p-4"
        style={{ borderColor: "var(--border)" }}>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">啟動代理</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[3fr_1fr_auto]">
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="目標使用者 UUID（從 /admin/permissions 找）"
            className="input font-mono text-xs"
            disabled={!!active}
          />
          <input
            type="number"
            min={1}
            max={60}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="input"
            title="持續分鐘數"
            disabled={!!active}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={onStart}
            disabled={busy || !!active || !userId.trim()}>
            <UserCog size={14} aria-hidden />
            啟動
          </button>
        </div>
      </section>

      {active && (
        <section
          className="mb-4 rounded-lg border p-4"
          style={{
            background: "var(--warning-dim)",
            borderColor: "var(--warning-border)",
          }}>
          <div className="flex items-start gap-2">
            <AlertTriangle
              size={16}
              aria-hidden
              className="mt-0.5 flex-shrink-0 text-[var(--warning)]"
            />
            <div className="flex-1">
              <div className="font-semibold text-[var(--warning)]">
                Impersonation 進行中 · 剩餘 {active.expires_in_minutes} 分鐘
              </div>
              <p className="mt-1 text-xs">
                目標：<code>{active.target_email}</code>（{active.target_user_id.slice(0, 8)}…）
              </p>
              <p className="mt-2 text-xs">
                現在的頁面、權限與所有 API 請求都已切換為目標使用者；可依目標使用者的實際
                權限執行修改，稽核紀錄會標示代行管理員。
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className="btn-sm btn-danger" onClick={onEnd} disabled={busy}>
                  <LogOut size={12} aria-hidden />
                  結束代理
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <div
        className="rounded-md border px-4 py-3 text-xs"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
          安全規則
        </h3>
        <ul className="ml-5 list-disc space-y-1 text-[var(--text-secondary)]">
          <li>不能 impersonate superuser（除非自己也是 superuser）</li>
          <li>修改權限完全依目標使用者，無法借用管理員本身的額外權限</li>
          <li>所有修改的 audit log 都會標示「由 XX 管理員代行」</li>
          <li>token 寫入 jti 黑名單後立即失效；最長 60 分鐘自動過期</li>
          <li>不能 impersonate 自己</li>
        </ul>
      </div>
    </main>
  );
}
