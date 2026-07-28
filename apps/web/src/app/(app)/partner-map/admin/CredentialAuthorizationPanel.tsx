"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { ApiError, electronicCredentialsApi } from "@/lib/api";
import type {
  ElectronicCredentialAuthorizationOut,
} from "@/lib/types";
import { toast } from "sonner";

const IDENTITY_PRESETS = ["特殊授權", "家長會志工", "活動協力人員", "校友志工"];

type AuthorizationForm = {
  email: string;
  identity_label: string;
  note: string;
};

const emptyForm = (): AuthorizationForm => ({
  email: "",
  identity_label: "特殊授權",
  note: "",
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export default function CredentialAuthorizationPanel() {
  const [authorizations, setAuthorizations] = useState<ElectronicCredentialAuthorizationOut[]>([]);
  const [form, setForm] = useState<AuthorizationForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAuthorizations(await electronicCredentialsApi.adminListAuthorizations(includeInactive));
    } catch (error) {
      toast.error(getErrorMessage(error, "載入特殊身分授權失敗"));
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.email.trim() || !form.identity_label.trim()) {
      toast.error("請填寫登入 Email 與顯示身分");
      return;
    }

    setSaving(true);
    try {
      const body = {
        email: form.email.trim(),
        identity_label: form.identity_label.trim(),
        note: form.note.trim() || null,
      };
      if (editingId) {
        await electronicCredentialsApi.adminUpdateAuthorization(editingId, body);
        toast.success("特殊身分授權已更新");
      } else {
        await electronicCredentialsApi.adminCreateAuthorization(body);
        toast.success("特殊身分授權已建立");
      }
      resetForm();
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, "儲存特殊身分授權失敗"));
    } finally {
      setSaving(false);
    }
  };

  const edit = (authorization: ElectronicCredentialAuthorizationOut) => {
    setEditingId(authorization.id);
    setForm({
      email: authorization.email,
      identity_label: authorization.identity_label,
      note: authorization.note || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggle = async (authorization: ElectronicCredentialAuthorizationOut) => {
    try {
      await electronicCredentialsApi.adminUpdateAuthorization(authorization.id, {
        is_active: !authorization.is_active,
      });
      toast.success(authorization.is_active ? "授權已停用" : "授權已重新啟用");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, "更新授權狀態失敗"));
    }
  };

  const activeCount = authorizations.filter((authorization) => authorization.is_active).length;

  return (
    <section id="credentials-panel" role="tabpanel" aria-label="特殊身分管理" className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <section className="card p-5">
          <div className="mb-5 flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ color: "var(--primary)", background: "var(--primary-dim)" }}>
              <ShieldCheck size={18} aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                {editingId ? "編輯特殊身分" : "新增特殊身分"}
              </h2>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                指定帳號與電子證件上要顯示的身份名稱。
              </p>
            </div>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            <label className="grid gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>登入 Email</span>
              <input
                className="input"
                type="email"
                required
                placeholder="例如：parent@example.com"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              />
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                帳號尚未登入也可以先建立授權。
              </span>
            </label>

            <div className="grid gap-2">
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>常用身份</span>
              <div className="flex flex-wrap gap-2">
                {IDENTITY_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="rounded-full border px-3 py-1.5 text-xs transition-colors"
                    style={{
                      borderColor: form.identity_label === preset ? "var(--primary)" : "var(--border)",
                      background: form.identity_label === preset ? "var(--primary-dim)" : "transparent",
                      color: form.identity_label === preset ? "var(--primary)" : "var(--text-secondary)",
                    }}
                    onClick={() => setForm((current) => ({ ...current, identity_label: preset }))}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <label className="grid gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>卡面顯示身份</span>
              <input
                className="input"
                required
                maxLength={80}
                placeholder="例如：家長會志工"
                value={form.identity_label}
                onChange={(event) => setForm((current) => ({ ...current, identity_label: event.target.value }))}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>管理備註（選填）</span>
              <textarea
                className="input min-h-20 resize-y"
                maxLength={2000}
                placeholder="例如：2026 學年度家長會志工"
                value={form.note}
                onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
              />
            </label>

            <div className="flex items-center justify-end gap-2">
              {editingId && (
                <button type="button" className="btn btn-ghost" onClick={resetForm}>
                  <X size={15} aria-hidden="true" />取消編輯
                </button>
              )}
              <button type="submit" className="btn" disabled={saving} style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }}>
                {editingId ? <Check size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
                {saving ? "儲存中…" : editingId ? "儲存變更" : "建立授權"}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
          <div className="flex items-start gap-3">
            <Mail size={16} className="mt-0.5 shrink-0" style={{ color: "var(--primary)" }} aria-hidden="true" />
            <p className="text-xs leading-5" style={{ color: "var(--text-muted)" }}>
              授權會套用在電子證件卡面；停用後，該帳號仍可依原本的校內資格使用證件，但不會再顯示這個特殊身份。
            </p>
          </div>
        </section>
      </div>

      <section className="card p-5">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>已授權帳號</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              目前 {activeCount} 筆啟用中，可直接修改顯示身份或停用授權。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} />
              顯示已停用
            </label>
            <button type="button" className="topbar-icon-btn" onClick={() => void load()} aria-label="重新整理授權" title="重新整理">
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3" aria-busy="true">
            {[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg" style={{ background: "var(--bg-elevated)" }} />)}
          </div>
        ) : authorizations.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center" style={{ borderColor: "var(--border)" }}>
            <UserRound size={24} className="mx-auto" style={{ color: "var(--text-muted)" }} aria-hidden="true" />
            <p className="mt-3 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>尚未建立特殊身分授權</p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>從左側新增第一筆授權即可開始。</p>
          </div>
        ) : (
          <div className="space-y-3">
            {authorizations.map((authorization) => (
              <div key={authorization.id} className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: authorization.is_active ? "var(--border)" : "var(--border-strong)", opacity: authorization.is_active ? 1 : 0.68 }}>
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ color: authorization.is_active ? "var(--primary)" : "var(--text-muted)", background: authorization.is_active ? "var(--primary-dim)" : "var(--bg-elevated)" }}>
                    <UserRound size={17} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{authorization.identity_label}</p>
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: authorization.is_active ? "var(--success)" : "var(--text-muted)", background: authorization.is_active ? "var(--success-dim)" : "var(--bg-elevated)" }}>
                        {authorization.is_active ? "啟用中" : "已停用"}
                      </span>
                    </div>
                    <p className="mt-1 flex items-center gap-1 truncate text-xs" style={{ color: "var(--text-secondary)" }}>
                      <Mail size={12} aria-hidden="true" />{authorization.email}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {authorization.display_name ? `${authorization.display_name}${authorization.student_id ? ` · ${authorization.student_id}` : ""}` : "尚未建立平台帳號，登入後即會套用授權"}
                    </p>
                    {authorization.note && <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>{authorization.note}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                  <button type="button" className="btn btn-ghost h-9 px-3 text-xs" onClick={() => edit(authorization)}>
                    <Pencil size={14} aria-hidden="true" />編輯
                  </button>
                  <button type="button" className="btn btn-secondary h-9 px-3 text-xs" onClick={() => void toggle(authorization)}>
                    {authorization.is_active ? "停用" : "啟用"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
