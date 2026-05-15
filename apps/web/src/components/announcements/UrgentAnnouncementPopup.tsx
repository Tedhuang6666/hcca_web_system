"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { announcementsApi } from "@/lib/api";
import type { AnnouncementOut } from "@/lib/types";
import AnnouncementMarkdown from "./AnnouncementMarkdown";

export default function UrgentAnnouncementPopup() {
  const [item, setItem] = useState<AnnouncementOut | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    announcementsApi.activeUrgent()
      .then((announcement) => {
        if (!mounted || !announcement) return;
        const key = `urgent-announcement:${announcement.id}:${announcement.updated_at}`;
        if (sessionStorage.getItem(key) === "dismissed") return;
        setItem(announcement);
        setOpen(true);
      })
      .catch(() => { /* public best-effort popup */ });
    return () => { mounted = false; };
  }, []);

  if (!item || !open) return null;

  const dismiss = () => {
    sessionStorage.setItem(`urgent-announcement:${item.id}:${item.updated_at}`, "dismissed");
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: "var(--bg-overlay)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="urgent-announcement-title">
      <div className="absolute inset-0" onClick={dismiss} aria-hidden="true" />
      <section className="relative w-full max-w-2xl overflow-hidden rounded-lg"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--danger-border)", boxShadow: "var(--shadow-xl)" }}>
        <div className="flex items-center justify-between gap-3 px-5 py-3"
          style={{ background: "var(--danger-dim)", borderBottom: "1px solid var(--danger-border)" }}>
          <div className="min-w-0">
            <p className="text-xs font-medium" style={{ color: "var(--danger)" }}>緊急公告</p>
            <h2 id="urgent-announcement-title" className="truncate text-lg font-semibold">
              {item.title}
            </h2>
          </div>
          <button type="button" className="topbar-icon-btn flex-shrink-0" onClick={dismiss} aria-label="關閉緊急公告">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="max-h-[62vh] overflow-y-auto p-5">
          <AnnouncementMarkdown content={item.content} />
          <div className="mt-6 border-t pt-4 text-sm"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
            公告人：{item.author_name || "未命名"}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4" style={{ borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost" onClick={dismiss}>稍後再看</button>
          <Link href={`/announcements/${item.id}`} className="btn btn-primary" onClick={dismiss}>
            查看公告
          </Link>
        </div>
      </section>
    </div>
  );
}
