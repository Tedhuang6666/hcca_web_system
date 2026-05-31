"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Ban, Copy, KeyRound, Lock, Plus, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import {
  ApiError,
  apiKeysApi,
  type ApiKeyCreatedResponse,
  type ApiKeyOut,
} from "@/lib/api";

export default function ApiKeysPage() {
  const { isAdmin } = usePermissions();
  const [keys, setKeys] = useState<ApiKeyOut[]>([]);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<ApiKeyCreatedResponse | null>(null);

  // create form state
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("");
  const [rateLimit, setRateLimit] = useState(60);
  const [expiresAt, setExpiresAt] = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await apiKeysApi.list(includeRevoked);
      setKeys(rows);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "讀取失敗");
    }
  }, [includeRevoked]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const onCreate = async () => {
    if (!name.trim()) {
      toast.error("name 必填");
      return;
    }
    setBusy(true);
    try {
      const r = await apiKeysApi.create({
        name: name.trim(),
        scopes: scopes
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        rate_limit_per_minute: rateLimit,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      setCreated(r);
      setName("");
      setScopes("");
      setExpiresAt("");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (key: ApiKeyOut) => {
    const reason = window.prompt(`撤銷 API key「${key.name}」（${key.key_prefix}...）的理由：`);
    if (reason === null) return;
    setBusy(true);
    try {
      await apiKeysApi.revoke(key.id, reason || "manual revoke");
      toast.success("已撤銷");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "撤銷失敗");
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已複製到剪貼簿");
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
    <main className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
            <KeyRound size={14} aria-hidden />
            API Keys（機器對機器存取）
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">API Keys</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
            用於外部腳本或第三方服務呼叫平台 API。**明文 key 只在建立時顯示一次**，
            遺失需重新建立。撤銷後該 key 立即失效。
          </p>
        </div>
        <div className="flex gap-2">
          <label className="inline-flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={includeRevoked}
              onChange={(e) => setIncludeRevoked(e.target.checked)}
            />
            顯示已撤銷
          </label>
          <button type="button" className="btn btn-ghost" onClick={load}>
            <RefreshCcw size={16} aria-hidden />
            重新整理
          </button>
        </div>
      </header>

      <section
        className="mb-4 rounded-lg border bg-[var(--bg-surface)] p-4"
        style={{ borderColor: "var(--border)" }}>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">建立新 API Key</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_2fr_1fr_1fr_auto]">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名稱（例：班級管理整合）"
            className="input"
          />
          <input
            type="text"
            value={scopes}
            onChange={(e) => setScopes(e.target.value)}
            placeholder="scopes（逗號分隔，例：read:document,write:meal）"
            className="input font-mono text-xs"
          />
          <input
            type="number"
            min={1}
            max={10000}
            value={rateLimit}
            onChange={(e) => setRateLimit(Number(e.target.value))}
            className="input"
            title="rate_limit_per_minute"
          />
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="input"
            title="expires_at（選填）"
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={onCreate}
            disabled={busy || !name.trim()}>
            <Plus size={14} aria-hidden />
            建立
          </button>
        </div>
      </section>

      {created && (
        <section
          className="mb-4 rounded-lg border p-4"
          style={{
            background: "var(--warning-dim)",
            borderColor: "var(--warning-border)",
            color: "var(--warning)",
          }}
          role="status">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} aria-hidden className="mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">{created.api_key.name} 已建立。請立即複製明文 key（之後無法再取得）：</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-[var(--bg-surface)] px-2 py-1 font-mono text-xs">
                  {created.key_plaintext}
                </code>
                <button
                  type="button"
                  className="btn-sm btn-primary"
                  onClick={() => copyKey(created.key_plaintext)}>
                  <Copy size={12} aria-hidden />
                  複製
                </button>
                <button
                  type="button"
                  className="btn-sm btn-ghost"
                  onClick={() => setCreated(null)}>
                  我已保存，關閉
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <section
        className="overflow-hidden rounded-lg border bg-[var(--bg-surface)]"
        style={{ borderColor: "var(--border)" }}>
        {keys.length === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--text-muted)]">尚無 API key。</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[var(--text-secondary)]">
              <tr className="border-b border-[var(--border)] bg-[var(--bg-base)]">
                <th className="px-3 py-2 text-left">名稱</th>
                <th className="px-3 py-2 text-left">key prefix</th>
                <th className="px-3 py-2 text-left">scopes</th>
                <th className="px-3 py-2 text-right">RL/分</th>
                <th className="px-3 py-2 text-right">最後使用</th>
                <th className="px-3 py-2 text-right">到期</th>
                <th className="px-3 py-2 text-center">狀態</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr
                  key={k.id}
                  className="border-b border-[var(--border)]"
                  style={{ opacity: k.is_active ? 1 : 0.5 }}>
                  <td className="px-3 py-2">{k.name}</td>
                  <td className="px-3 py-2 font-mono">{k.key_prefix}…</td>
                  <td className="px-3 py-2 font-mono text-[10px]">
                    {k.scopes.length === 0 ? "—" : k.scopes.join(", ")}
                  </td>
                  <td className="px-3 py-2 text-right">{k.rate_limit_per_minute}</td>
                  <td className="px-3 py-2 text-right">
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {k.expires_at ? new Date(k.expires_at).toLocaleDateString() : "永久"}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {k.is_active ? (
                      <span className="text-[var(--success)]">啟用</span>
                    ) : (
                      <span className="text-[var(--text-muted)]">已撤銷</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {k.is_active && (
                      <button
                        type="button"
                        className="btn-sm btn-danger"
                        onClick={() => onRevoke(k)}
                        disabled={busy}>
                        <Ban size={12} aria-hidden />
                        撤銷
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
