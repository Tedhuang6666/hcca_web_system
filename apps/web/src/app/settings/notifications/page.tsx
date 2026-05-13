"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError, notificationsApi } from "@/lib/api";
import type { NotificationPreferences } from "@/lib/types";

const OPTIONS: { key: keyof NotificationPreferences; label: string; desc: string }[] = [
  { key: "document_pending", label: "公文待審", desc: "有公文需要您審核或處理時提醒" },
  { key: "document_approved", label: "公文核准", desc: "您送出的公文通過審核時提醒" },
  { key: "document_rejected", label: "公文退回", desc: "公文被退回或需要修正時提醒" },
  { key: "document_recalled", label: "公文撤回", desc: "相關公文從簽核流程撤回時提醒" },
  { key: "announcement", label: "公告通知", desc: "重要公告、緊急公告與公告更新提醒" },
  { key: "system", label: "系統通知", desc: "平台維運、權限或安全相關提醒" },
];

export default function NotificationSettingsPage() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    notificationsApi.getPreferences()
      .then(setPrefs)
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入通知偏好失敗"))
      .finally(() => setLoading(false));
  }, []);

  const enabledCount = useMemo(() => {
    if (!prefs) return 0;
    return OPTIONS.filter((item) => prefs[item.key]).length;
  }, [prefs]);

  const update = async (next: NotificationPreferences) => {
    setPrefs(next);
    setSaving(true);
    try {
      const saved = await notificationsApi.updatePreferences(next);
      setPrefs(saved);
      toast.success("通知偏好已更新");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新失敗");
      notificationsApi.getPreferences().then(setPrefs).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: keyof NotificationPreferences) => {
    if (!prefs || saving) return;
    update({ ...prefs, [key]: !prefs[key] });
  };

  const setAll = (value: boolean) => {
    if (!prefs || saving) return;
    update({
      document_pending: value,
      document_approved: value,
      document_rejected: value,
      document_recalled: value,
      announcement: value,
      system: value,
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
            NOTIFICATION SETTINGS
          </p>
          <h1 className="mt-1 text-xl font-semibold">通知偏好設定</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            選擇哪些事件要出現在通知中心
          </p>
        </div>
        <Link href="/notifications" className="btn btn-ghost">
          回通知中心
        </Link>
      </header>

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <h2 className="text-sm font-semibold">訂閱項目</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {loading ? "載入中" : `${enabledCount} / ${OPTIONS.length} 項已啟用`}
              {saving ? "，儲存中" : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setAll(true)} disabled={!prefs || saving}>
              全部啟用
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAll(false)} disabled={!prefs || saving}>
              全部停用
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--primary)" }} />
          </div>
        ) : !prefs ? (
          <div className="px-5 py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            無法載入通知偏好。
          </div>
        ) : (
          <ul>
            {OPTIONS.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-4 px-5 py-4"
                style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {item.label}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {item.desc}
                  </p>
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <span className="text-xs" style={{ color: prefs[item.key] ? "var(--primary)" : "var(--text-muted)" }}>
                    {prefs[item.key] ? "啟用" : "停用"}
                  </span>
                  <input
                    type="checkbox"
                    checked={prefs[item.key]}
                    disabled={saving}
                    onChange={() => toggle(item.key)}
                    aria-label={`${item.label}${prefs[item.key] ? "停用" : "啟用"}`}
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
