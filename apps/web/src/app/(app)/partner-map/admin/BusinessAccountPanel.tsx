"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, Search, ShieldCheck, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { ApiError, partnerMapApi, usersApi } from "@/lib/api";
import type { UserSummary } from "@/lib/api/core";
import type { PartnerBusinessAccount } from "@/lib/partner-map-types";

export default function BusinessAccountPanel({ businessId }: { businessId: string }) {
  const [accounts, setAccounts] = useState<PartnerBusinessAccount[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<UserSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await partnerMapApi.adminBusinessAccounts(businessId);
      setAccounts(next);
      setSelectedIds(next.filter((account) => account.is_active).map((account) => account.user_id));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "載入店家帳號失敗");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open || search.trim().length < 2) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = await usersApi.listForSearch(search.trim());
        if (!cancelled) setOptions(next);
      } catch (error) {
        if (!cancelled) toast.error(error instanceof ApiError ? error.message : "搜尋使用者失敗");
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, search]);

  const addUser = (user: UserSummary) => {
    setSelectedIds((current) => current.includes(user.id) ? current : [...current, user.id]);
    setAccounts((current) => current.some((account) => account.user_id === user.id)
      ? current
      : [...current, {
        id: `new-${user.id}`,
        business_id: businessId,
        user_id: user.id,
        display_name: user.display_name,
        email: user.email,
        is_active: true,
        created_at: "",
        updated_at: "",
      }]);
    setSearch("");
    setOpen(false);
  };

  const removeUser = (userId: string) => {
    setSelectedIds((current) => current.filter((id) => id !== userId));
  };

  const save = async () => {
    setSaving(true);
    try {
      const next = await partnerMapApi.replaceBusinessAccounts(businessId, selectedIds);
      setAccounts(next);
      setSelectedIds(next.filter((account) => account.is_active).map((account) => account.user_id));
      toast.success("已更新店家帳號權限");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "更新店家帳號失敗");
    } finally {
      setSaving(false);
    }
  };

  const activeAccounts = accounts.filter((account) => selectedIds.includes(account.user_id));

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            <ShieldCheck size={16} aria-hidden="true" />店家帳號權限
          </h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            被指定的帳號可從「我的店家」更新公開基本資料與營業時間；可設定一個或多個帳號。
          </p>
        </div>
        <button type="button" className="topbar-icon-btn" onClick={() => void load()} aria-label="重新整理店家帳號">
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="relative mt-4">
        <label className="flex items-center gap-2 rounded-md border px-3 py-2" style={{ borderColor: "var(--border)" }}>
          <Search size={15} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            placeholder="搜尋姓名或 Email 以新增帳號"
            value={search}
            onFocus={() => setOpen(true)}
            onChange={(event) => { setSearch(event.target.value); setOpen(true); }}
          />
        </label>
        {open && options.length > 0 && (
          <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-20 max-h-56 overflow-y-auto rounded-md border p-1" style={{ background: "var(--bg-surface)", borderColor: "var(--border-strong)" }}>
            {options.map((user) => (
              <button key={user.id} type="button" className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[var(--bg-elevated)]" onClick={() => addUser(user)}>
                <UserRound size={15} aria-hidden="true" style={{ color: "var(--primary)" }} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm" style={{ color: "var(--text-primary)" }}>{user.display_name}</span><span className="block truncate text-xs" style={{ color: "var(--text-muted)" }}>{user.email}</span></span>
                {selectedIds.includes(user.id) && <Check size={15} aria-hidden="true" style={{ color: "var(--primary)" }} />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2" aria-live="polite">
        {loading ? <p className="text-xs" style={{ color: "var(--text-muted)" }}>載入帳號中…</p> : activeAccounts.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-xs" style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}>尚未指定店家帳號。</p>
        ) : activeAccounts.map((account) => (
          <div key={account.user_id} className="flex items-center gap-2 rounded-md border px-3 py-2" style={{ borderColor: "var(--border)" }}>
            <UserRound size={15} aria-hidden="true" style={{ color: "var(--primary)" }} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm" style={{ color: "var(--text-primary)" }}>{account.display_name}</span><span className="block truncate text-xs" style={{ color: "var(--text-muted)" }}>{account.email}</span></span>
            <button type="button" className="topbar-icon-btn" onClick={() => removeUser(account.user_id)} aria-label={`移除 ${account.display_name}`}><X size={14} /></button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" className="btn btn-primary" disabled={saving || loading} onClick={() => void save()}>{saving ? "儲存中…" : "儲存帳號權限"}</button>
      </div>
    </section>
  );
}
