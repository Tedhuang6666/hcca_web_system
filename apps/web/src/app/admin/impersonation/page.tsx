"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Copy,
  Lock,
  LogOut,
  ShieldHalf,
  UserCog,
} from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import {
  ApiError,
  impersonationApi,
  type ImpersonationStartResponse,
} from "@/lib/api";

export default function ImpersonationPage() {
  const { isAdmin } = usePermissions();
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
          `所有操作會被記為「以 ${id} 身分（actor=你）」。\n` +
          `預設 read-only：嘗試寫入會被中介層擋下。\n\n` +
          `繼續？`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await impersonationApi.start(id, minutes);
      setActive(r);
      toast.success(`已啟動 ${r.expires_in_minutes} 分鐘 impersonation`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "啟動失敗");
    } finally {
      setBusy(false);
    }
  };

  const onEnd = async () => {
    if (!active) return;
    setBusy(true);
    try {
      await impersonationApi.end(active.token, "manual_end");
      toast.success("已結束 impersonation（token 已撤銷）");
      setActive(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "結束失敗");
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.token);
      toast.success("已複製 token");
    } catch {
      toast.error("複製失敗，請手動選取");
    }
  };

  if (!isAdmin) {
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
          以另一名使用者身分檢視平台（read-only 模式）。需要 <code>admin:impersonate</code>{" "}
          權限。所有操作會寫入 audit log，actor 顯示為你、subject 顯示為目標使用者。
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
            max={120}
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
                <strong>使用方式</strong>：複製下方 token，在 Postman / curl
                / 開無痕視窗手動設定 <code>Authorization: Bearer {"{token}"}</code>{" "}
                呼叫 API。
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-[var(--bg-surface)] px-2 py-1 font-mono text-[10px] max-w-full">
                  {active.token}
                </code>
                <button type="button" className="btn-sm btn-primary" onClick={copyToken}>
                  <Copy size={12} aria-hidden />
                  複製
                </button>
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
          <li>不能 impersonate 自己</li>
          <li>不能 impersonate superuser（除非自己也是 superuser）</li>
          <li>token 預設 read-only：嘗試寫入請求會被中介層拒絕</li>
          <li>token 寫入 jti 黑名單後立即失效；最長 120 分鐘自動過期</li>
          <li>所有 start / end 都會寫 audit log，方便事後稽核</li>
        </ul>
      </div>
    </main>
  );
}
