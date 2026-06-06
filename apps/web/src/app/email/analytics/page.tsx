"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ApiError, emailApi } from "@/lib/api";
import type { EmailAnalyticsOut, EmailMessageOut } from "@/lib/types";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export default function EmailAnalyticsPage() {
  const [messages, setMessages] = useState<EmailMessageOut[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [analytics, setAnalytics] = useState<EmailAnalyticsOut | null>(null);

  useEffect(() => {
    emailApi.listMessages({ limit: 100 }).then(setMessages).catch(() => toast.error("載入郵件失敗"));
  }, []);

  const load = async (id: string) => {
    setSelectedId(id);
    if (!id) return setAnalytics(null);
    try {
      setAnalytics(await emailApi.getAnalytics(id));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "載入分析失敗");
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>EMAIL</p>
          <h1 className="mt-1 text-xl font-semibold">寄送分析</h1>
        </div>
        <Link href="/email/logs" className="btn btn-ghost btn-sm">寄信紀錄</Link>
      </header>
      <select className="input" value={selectedId} onChange={(e) => void load(e.target.value)}>
        <option value="">選擇一封郵件…</option>
        {messages.filter((row) => row.recipient_count > 0).map((row) => (
          <option key={row.id} value={row.id}>{row.subject}（{row.recipient_count} 人）</option>
        ))}
      </select>
      {analytics && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["投遞率", percent(analytics.delivery_rate)],
              ["退信率", percent(analytics.bounce_rate)],
              ["開信率（估計）", percent(analytics.open_rate_estimated)],
              ["點擊率", percent(analytics.click_rate)],
              ["投訴", String(analytics.complained)],
            ].map(([label, value]) => (
              <div key={label} className="card p-4">
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</p>
                <p className="mt-2 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </section>
          <section className="card p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <h2 className="font-semibold">熱門連結</h2>
              <div className="flex gap-2">
                <a className="btn btn-ghost btn-sm" href={emailApi.exportUrl(selectedId, "csv")}>匯出 CSV</a>
                <a className="btn btn-ghost btn-sm" href={emailApi.exportUrl(selectedId, "xlsx")}>匯出 XLSX</a>
              </div>
            </div>
            {analytics.top_links.length === 0 ? (
              <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>尚無點擊資料。</p>
            ) : analytics.top_links.map((link) => (
              <div key={link.url} className="mt-3 flex justify-between gap-4 text-sm">
                <span className="truncate">{link.url}</span><strong>{link.clicks}</strong>
              </div>
            ))}
          </section>
          <section className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">尚未開信（{analytics.unopened_emails.length}）</h2>
              <button
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  const draft = await emailApi.cloneMessage(selectedId, "unopened");
                  window.location.href = `/email?draft=${draft.id}`;
                }}
              >
                建立提醒郵件
              </button>
            </div>
            <div className="mt-3 max-h-56 overflow-auto font-mono text-xs">
              {analytics.unopened_emails.map((email) => <p key={email}>{email}</p>)}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
