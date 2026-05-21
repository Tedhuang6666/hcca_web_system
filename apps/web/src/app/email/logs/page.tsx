"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError, emailApi } from "@/lib/api";
import type { EmailMessageOut, EmailStatus } from "@/lib/types";

const TABS: { key: string; label: string }[] = [
  { key: "", label: "全部" },
  { key: "draft", label: "草稿" },
  { key: "scheduled", label: "已排程" },
  { key: "queued", label: "寄送中" },
  { key: "sent", label: "已寄送" },
  { key: "failed", label: "失敗" },
];

const STATUS_META: Record<EmailStatus, { label: string; color: string }> = {
  draft: { label: "草稿", color: "var(--text-muted)" },
  scheduled: { label: "已排程", color: "var(--primary)" },
  queued: { label: "寄送中", color: "var(--primary)" },
  sent: { label: "已寄送", color: "var(--success)" },
  failed: { label: "失敗", color: "var(--danger)" },
  cancelled: { label: "已取消", color: "var(--text-muted)" },
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" });
}

export default function EmailLogsPage() {
  const [tab, setTab] = useState("");
  const [rows, setRows] = useState<EmailMessageOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    emailApi
      .listMessages({ status: tab || undefined, limit: 100 })
      .then(setRows)
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const sendDraft = async (id: string) => {
    setBusyId(id);
    try {
      await emailApi.sendMessage(id);
      toast.success("已排入寄送佇列");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "寄送失敗");
    } finally {
      setBusyId(null);
    }
  };

  const removeMessage = async (id: string, scheduled: boolean) => {
    if (!confirm(scheduled ? "確定取消這封預約郵件？" : "確定刪除這封草稿？")) return;
    setBusyId(id);
    try {
      await emailApi.deleteMessage(id);
      toast.success(scheduled ? "已取消預約" : "草稿已刪除");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失敗");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
            EMAIL LOGS
          </p>
          <h1 className="mt-1 text-xl font-semibold">寄信紀錄</h1>
        </div>
        <Link href="/email" className="btn btn-primary btn-sm">
          寄送新信件
        </Link>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            style={
              tab === t.key
                ? { background: "var(--primary)", color: "#1a1a2e" }
                : { background: "var(--bg-elevated)", color: "var(--text-muted)" }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <section className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16" role="status">
            <div
              className="h-7 w-7 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--primary)" }}
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            尚無寄信紀錄
          </div>
        ) : (
          <ul>
            {rows.map((m) => {
              const meta = STATUS_META[m.status];
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {m.subject}
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                      {m.sender_name ?? "—"} · {m.recipient_count} 人 ·{" "}
                      {m.status === "scheduled"
                        ? `預約 ${fmt(m.scheduled_at)}`
                        : fmt(m.created_at)}
                    </p>
                  </div>
                  <span className="text-xs font-semibold" style={{ color: meta.color }}>
                    {meta.label}
                  </span>
                  <div className="flex gap-1.5">
                    {m.status === "draft" && (
                      <>
                        <Link href={`/email?draft=${m.id}`} className="btn btn-ghost btn-sm">
                          編輯
                        </Link>
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={busyId === m.id}
                          onClick={() => sendDraft(m.id)}
                        >
                          送出
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={busyId === m.id}
                          onClick={() => removeMessage(m.id, false)}
                        >
                          刪除
                        </button>
                      </>
                    )}
                    {m.status === "scheduled" && (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busyId === m.id}
                        onClick={() => removeMessage(m.id, true)}
                      >
                        取消預約
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
