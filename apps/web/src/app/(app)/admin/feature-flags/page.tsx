"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  Flag,
  Lock,
  Plus,
  RefreshCcw,
  Save } from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import {
  featureFlagsApi,
  type FeatureFlagOut, apiErrorMessage } from "@/lib/api";

const SYSTEM_EMAIL_FLAG_KEYS = ["email_scheduled_dispatch", "email_error_report"];

export default function FeatureFlagsPage() {
  const { isAdmin } = usePermissions();
  const [flags, setFlags] = useState<FeatureFlagOut[]>([]);
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const otherFlags = flags.filter((flag) => !SYSTEM_EMAIL_FLAG_KEYS.includes(flag.key));

  const load = useCallback(async () => {
    try {
      const rows = await featureFlagsApi.list();
      setFlags(rows);
    } catch (e) {
      toast.error(apiErrorMessage(e, "讀取失敗"));
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const onCreate = async () => {
    const key = newKey.trim();
    if (!key) {
      toast.error("flag key 不可空");
      return;
    }
    setBusy(true);
    try {
      await featureFlagsApi.create({ key, description: newDesc.trim() || null });
      toast.success(`已新增 ${key}`);
      setNewKey("");
      setNewDesc("");
      await load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "新增失敗"));
    } finally {
      setBusy(false);
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
            <Flag size={14} aria-hidden />
            Feature Flags
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Feature Flags</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
            控制功能的全域開關 / 漸進放量 / 白名單。前端用 <code>GET /feature-flags/me</code>{" "}
            評估結果做條件渲染。
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={load}>
          <RefreshCcw size={16} aria-hidden />
          重新整理
        </button>
      </header>

      <section
        className="mb-4 rounded-lg border bg-[var(--bg-surface)] p-4"
        style={{ borderColor: "var(--border)" }}>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">新增 Flag</h2>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="key（小寫英數底線；例：new_meeting_ui）"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="input min-w-[14rem] flex-1 font-mono text-xs"
          />
          <input
            type="text"
            placeholder="說明（選填）"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className="input min-w-[18rem] flex-1"
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={onCreate}
            disabled={busy || !newKey.trim()}>
            <Plus size={14} aria-hidden />
            新增
          </button>
        </div>
      </section>

      <section className="space-y-2">
        {otherFlags.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">沒有其他自訂 flag。</p>
        ) : (
          otherFlags.map((f) => <FlagRow key={f.id} flag={f} onChange={load} />)
        )}
      </section>
    </main>
  );
}

function FlagRow({ flag, onChange }: { flag: FeatureFlagOut; onChange: () => void }) {
  const [globally, setGlobally] = useState(flag.is_globally_enabled);
  const [pct, setPct] = useState(flag.percentage_rollout);
  const [users, setUsers] = useState(flag.enabled_user_ids.join("\n"));
  const [perms, setPerms] = useState(flag.enabled_permission_codes.join("\n"));
  const [busy, setBusy] = useState(false);

  const onSave = async () => {
    setBusy(true);
    try {
      await featureFlagsApi.update(flag.id, {
        is_globally_enabled: globally,
        percentage_rollout: Number.isFinite(pct) ? pct : 0,
        enabled_user_ids: users
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean),
        enabled_permission_codes: perms
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
      toast.success(`已儲存 ${flag.key}`);
      onChange();
    } catch (e) {
      toast.error(apiErrorMessage(e, "儲存失敗"));
    } finally {
      setBusy(false);
    }
  };

  const onArchive = async () => {
    if (!window.confirm(`封存 flag「${flag.key}」？封存後不會再被評估。`)) return;
    setBusy(true);
    try {
      await featureFlagsApi.archive(flag.id);
      toast.success("已封存");
      onChange();
    } catch (e) {
      toast.error(apiErrorMessage(e, "封存失敗"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className="rounded-lg border bg-[var(--bg-surface)] p-4"
      style={{
        borderColor: flag.archived_at ? "var(--text-muted)" : "var(--border)",
        opacity: flag.archived_at ? 0.6 : 1,
      }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <code className="text-sm font-semibold text-[var(--text-primary)]">{flag.key}</code>
          {flag.archived_at && (
            <span className="ml-2 rounded bg-[var(--text-muted)] px-1 py-0.5 text-[10px] text-white">
              ARCHIVED
            </span>
          )}
          {flag.description && (
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">{flag.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-sm btn-ghost"
            onClick={onArchive}
            disabled={busy || !!flag.archived_at}>
            <Archive size={12} aria-hidden />
            封存
          </button>
          <button
            type="button"
            className="btn-sm btn-primary"
            onClick={onSave}
            disabled={busy || !!flag.archived_at}>
            <Save size={12} aria-hidden />
            儲存
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={globally}
            onChange={(e) => setGlobally(e.target.checked)}
          />
          <span>全域啟用（所有 user 都評估為 true）</span>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span>%放量：</span>
          <input
            type="number"
            min={0}
            max={100}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            className="input w-20"
          />
          <span className="text-[var(--text-muted)]">%</span>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--text-secondary)]">白名單 user_id（每行一個）</span>
          <textarea
            rows={3}
            value={users}
            onChange={(e) => setUsers(e.target.value)}
            className="input font-mono text-[11px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--text-secondary)]">白名單權限碼（每行一個）</span>
          <textarea
            rows={3}
            value={perms}
            onChange={(e) => setPerms(e.target.value)}
            placeholder="例：admin:all"
            className="input font-mono text-[11px]"
          />
        </label>
      </div>
    </article>
  );
}
