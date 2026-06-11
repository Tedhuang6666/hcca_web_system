"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  RefreshCcw,
  RotateCcw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { usePermissions } from "@/hooks/usePermissions";
import {
  ApiError,
  systemApi,
  type AppSettingField,
  type AppSettingsListResponse, apiErrorMessage } from "@/lib/api";

type MfaPurpose =
  | { kind: "reveal"; keys: string[] }
  | { kind: "save"; changes: Record<string, string> };

export default function SystemSettingsPage() {
  const { isAdmin } = usePermissions();
  const [data, setData] = useState<AppSettingsListResponse | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [mfaPrompt, setMfaPrompt] = useState<MfaPurpose | null>(null);
  const [restartScheduled, setRestartScheduled] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const resp = await systemApi.listAppSettings();
      setData(resp);
      setDisabled(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setDisabled(true);
        setData(null);
        return;
      }
      setLoadError(apiErrorMessage(e, "讀取系統設定失敗"));
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const grouped = useMemo(() => {
    const map = new Map<string, AppSettingField[]>();
    for (const field of data?.fields ?? []) {
      const arr = map.get(field.category) ?? [];
      arr.push(field);
      map.set(field.category, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  const toggleSection = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const valueFor = (field: AppSettingField): string => {
    if (changes[field.key] !== undefined) return changes[field.key];
    if (field.is_secret && revealed[field.key] !== undefined) return revealed[field.key];
    return field.value;
  };

  const onChangeField = (key: string, value: string) => {
    setChanges((prev) => ({ ...prev, [key]: value }));
  };

  const requestReveal = (keys: string[]) => {
    setMfaPrompt({ kind: "reveal", keys });
  };

  const requestSave = () => {
    if (Object.keys(changes).length === 0) {
      toast.info("沒有變更可儲存");
      return;
    }
    setMfaPrompt({ kind: "save", changes });
  };

  const submitMfa = async (code: string) => {
    if (!mfaPrompt) return;
    try {
      if (mfaPrompt.kind === "reveal") {
        const out = await systemApi.revealAppSettings(code, mfaPrompt.keys);
        setRevealed((prev) => ({ ...prev, ...out.values }));
        toast.success("已取得密鑰明文");
      } else {
        const out = await systemApi.saveAppSettings(code, mfaPrompt.changes);
        toast.success(`已儲存 ${out.updated.length} 項，需重啟才生效`);
        setRestartScheduled(out.restart_required);
        setChanges({});
        setRevealed({});
        await load();
      }
      setMfaPrompt(null);
    } catch (e) {
      toast.error(apiErrorMessage(e, "操作失敗"));
    }
  };

  const triggerRestart = async () => {
    if (!window.confirm("立即重啟 API 服務以套用變更？")) return;
    try {
      const out = await systemApi.restartService();
      toast.success(`重啟已排程（環境：${out.environment}）`);
      setRestartScheduled(false);
    } catch (e) {
      toast.error(apiErrorMessage(e, "重啟失敗"));
    }
  };

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section
          className="rounded-lg border p-8 text-center"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border)",
          }}>
          <Lock className="mx-auto mb-3 text-[var(--danger)]" size={32} aria-hidden />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">需要超級管理員權限</h1>
        </section>
      </main>
    );
  }

  if (disabled) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section
          className="rounded-lg border p-8 text-center"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border)",
          }}>
          <AlertTriangle className="mx-auto mb-3 text-[var(--warning)]" size={32} aria-hidden />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">功能未啟用</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            系統設定編輯頁是高風險功能，預設關閉。請於 <code>.env</code> 設定{" "}
            <code>ENABLE_ENV_EDITOR=true</code> 並重啟 API 後再進入。
          </p>
        </section>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-[var(--text-secondary)]">{loadError ?? "載入中…"}</p>
      </main>
    );
  }

  const dirtyCount = Object.keys(changes).length;

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
            <ShieldCheck size={14} aria-hidden />
            超級管理員 / 高危功能
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">系統設定</h1>
          <p className="mt-1 break-all text-xs text-[var(--text-muted)]">
            檔案：<code>{data.env_path}</code>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={load} className="btn btn-ghost">
            <RefreshCcw size={16} aria-hidden />
            重新整理
          </button>
          <button
            type="button"
            onClick={requestSave}
            disabled={dirtyCount === 0}
            className="btn btn-primary">
            <Save size={16} aria-hidden />
            儲存{dirtyCount > 0 ? `（${dirtyCount} 項）` : ""}
          </button>
          {restartScheduled && (
            <button type="button" onClick={triggerRestart} className="btn btn-danger">
              <RotateCcw size={16} aria-hidden />
              重啟以套用
            </button>
          )}
        </div>
      </header>

      {!data.mfa_enabled && (
        <div
          className="mb-4 flex items-start gap-2 rounded-md border px-4 py-3 text-sm"
          style={{
            background: "var(--warning-dim)",
            borderColor: "var(--warning-border)",
            color: "var(--warning)",
          }}
          role="status">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 flex-shrink-0" />
          <span>
            你目前帳號未啟用 MFA。顯示明文密鑰與儲存任何變更都需 MFA 再驗證，請先到「安全設定」啟用。
          </span>
        </div>
      )}

      <div className="space-y-3">
        {grouped.map(([category, fields]) => {
          const isCollapsed = collapsed.has(category);
          const dirtyInCat = fields.filter((f) => changes[f.key] !== undefined).length;
          return (
            <section
              key={category}
              className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-sm">
              <button
                type="button"
                onClick={() => toggleSection(category)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
                aria-expanded={!isCollapsed}>
                <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  {category}
                  <span className="text-xs font-normal text-[var(--text-muted)]">
                    {fields.length} 項
                  </span>
                  {dirtyInCat > 0 && (
                    <span className="rounded bg-[var(--primary-dim)] px-1.5 py-0.5 text-xs text-[var(--primary)]">
                      未存 {dirtyInCat}
                    </span>
                  )}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {isCollapsed ? "展開" : "收合"}
                </span>
              </button>
              {!isCollapsed && (
                <div className="divide-y divide-[var(--border)]">
                  {fields.map((field) => (
                    <FieldRow
                      key={field.key}
                      field={field}
                      value={valueFor(field)}
                      dirty={changes[field.key] !== undefined}
                      revealed={
                        field.is_secret && (revealed[field.key] !== undefined || changes[field.key] !== undefined)
                      }
                      onChange={(v) => onChangeField(field.key, v)}
                      onReveal={() => requestReveal([field.key])}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {mfaPrompt && (
        <MfaModal
          purpose={mfaPrompt}
          onCancel={() => setMfaPrompt(null)}
          onSubmit={submitMfa}
        />
      )}
    </main>
  );
}

function FieldRow({
  field,
  value,
  dirty,
  revealed,
  onChange,
  onReveal,
}: {
  field: AppSettingField;
  value: string;
  dirty: boolean;
  revealed: boolean;
  onChange: (v: string) => void;
  onReveal: () => void;
}) {
  const masked = field.is_secret && !revealed;
  return (
    <div className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[18rem_1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <code className="text-xs font-medium text-[var(--text-primary)]">{field.key}</code>
          {field.is_secret && (
            <span className="rounded bg-[var(--warning-dim)] px-1 py-0.5 text-[10px] font-medium text-[var(--warning)]">
              密鑰
            </span>
          )}
          {dirty && (
            <span className="rounded bg-[var(--primary-dim)] px-1 py-0.5 text-[10px] text-[var(--primary)]">
              未儲存
            </span>
          )}
          {!field.in_file && (
            <span
              className="rounded px-1 py-0.5 text-[10px] text-[var(--text-muted)]"
              title="使用 schema 預設值，.env 內未設定">
              預設
            </span>
          )}
        </div>
        {field.description && (
          <p className="mt-0.5 text-xs leading-snug text-[var(--text-muted)]">{field.description}</p>
        )}
      </div>
      <div className="min-w-0">
        {field.type === "bool" ? (
          <select
            value={value || "false"}
            onChange={(e) => onChange(e.target.value)}
            className="input w-32">
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : field.type === "list" ? (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder='JSON 陣列，如 ["a","b"]'
            className="input w-full font-mono"
          />
        ) : field.type === "number" ? (
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="input w-full font-mono"
          />
        ) : (
          <input
            type={masked ? "password" : "text"}
            value={masked ? "••••••" : value}
            disabled={masked}
            onChange={(e) => onChange(e.target.value)}
            className="input w-full font-mono"
          />
        )}
      </div>
      <div className="flex items-center gap-2 justify-self-end">
        {field.is_secret && !revealed && (
          <button type="button" onClick={onReveal} className="btn-sm btn-ghost" title="顯示明文（需 MFA）">
            <Eye size={14} aria-hidden />
            顯示
          </button>
        )}
        {field.is_secret && revealed && (
          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--warning)]" title="明文已顯示">
            <EyeOff size={12} aria-hidden />
            明文中
          </span>
        )}
      </div>
    </div>
  );
}

function MfaModal({
  purpose,
  onCancel,
  onSubmit,
}: {
  purpose: MfaPurpose;
  onCancel: () => void;
  onSubmit: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const title = purpose.kind === "reveal" ? "MFA 驗證：顯示密鑰" : "MFA 驗證：儲存變更";
  const detail =
    purpose.kind === "reveal"
      ? `將顯示 ${purpose.keys.length} 項密鑰明文，請輸入 6 位 TOTP 驗證碼。`
      : `將儲存 ${Object.keys(purpose.changes).length} 項設定到 .env，請輸入 6 位 TOTP 驗證碼。`;

  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      await onSubmit(code.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--bg-overlay)" }}
      onClick={onCancel}
      role="dialog"
      aria-modal="true">
      <div
        className="w-full max-w-md rounded-lg border p-5 shadow-xl"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2 text-[var(--text-primary)]">
          <KeyRound size={18} aria-hidden />
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <p className="mb-3 text-sm text-[var(--text-secondary)]">{detail}</p>
        <input
          type="text"
          inputMode="numeric"
          autoFocus
          maxLength={16}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="123456"
          className="input w-full font-mono text-center text-lg tracking-widest"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn btn-ghost" disabled={busy}>
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !code.trim()}
            className="btn btn-primary">
            {busy ? "驗證中…" : "確認"}
          </button>
        </div>
      </div>
    </div>
  );
}
