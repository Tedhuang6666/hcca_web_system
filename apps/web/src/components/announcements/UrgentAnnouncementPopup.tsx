"use client";

import { useEffect, useState } from "react";
import { announcementsApi } from "@/lib/api";
import { useLowDataMode } from "@/hooks/useLowDataMode";
import type { AnnouncementOut } from "@/lib/types";
import AnnouncementMarkdown from "./AnnouncementMarkdown";

const URGENT_CACHE_KEY = "hcca:urgent-announcement-cache";
const URGENT_CACHE_TTL_MS = 10 * 60 * 1000;

type UrgentAnnouncementCache = {
  checkedAt: number;
  item: AnnouncementOut | null;
};

function readUrgentCache(): UrgentAnnouncementCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(URGENT_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as UrgentAnnouncementCache;
    if (!Number.isFinite(cache.checkedAt)) return null;
    if (Date.now() - cache.checkedAt > URGENT_CACHE_TTL_MS) return null;
    return cache;
  } catch {
    return null;
  }
}

function writeUrgentCache(item: AnnouncementOut | null) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(URGENT_CACHE_KEY, JSON.stringify({ checkedAt: Date.now(), item }));
  } catch {
    /* storage quota or private mode */
  }
}

export default function UrgentAnnouncementPopup() {
  const [item, setItem] = useState<AnnouncementOut | null>(null);
  const [open, setOpen] = useState(false);
  const lowDataMode = useLowDataMode();

  useEffect(() => {
    let mounted = true;
    const cached = lowDataMode ? readUrgentCache() : null;
    if (cached) {
      if (cached.item) {
        const key = `urgent-announcement:${cached.item.id}:${cached.item.updated_at}`;
        if (cached.item.show_on_every_visit || sessionStorage.getItem(key) !== "dismissed") {
          setItem(cached.item);
          setOpen(true);
        }
      }
      return () => { mounted = false; };
    }
    announcementsApi.activeUrgent()
      .then((announcement) => {
        if (!mounted) return;
        writeUrgentCache(announcement);
        if (!announcement) return;
        const key = `urgent-announcement:${announcement.id}:${announcement.updated_at}`;
        if (!announcement.show_on_every_visit && sessionStorage.getItem(key) === "dismissed") return;
        setItem(announcement);
        setOpen(true);
      })
      .catch(() => { /* public best-effort popup */ });
    return () => { mounted = false; };
  }, [lowDataMode]);

  if (!item || !open) return null;

  const dismiss = () => {
    if (!item.show_on_every_visit) {
      sessionStorage.setItem(`urgent-announcement:${item.id}:${item.updated_at}`, "dismissed");
    }
    setOpen(false);
  };

  const target = item.link_url || `/announcements/${item.id}`;
  const targetLabel = item.link_label || (item.link_url ? "前往連結" : "查看公告");
  const opensExternal = /^https?:\/\//.test(target);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: "var(--bg-overlay)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="important-announcement-title">
      <div className="absolute inset-0" onClick={dismiss} aria-hidden="true" />
      <section className="relative w-full max-w-2xl overflow-hidden rounded-lg"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--warning-border)", boxShadow: "var(--shadow-xl)" }}>
        <div className="flex items-center justify-between gap-3 px-5 py-3"
          style={{ background: "var(--warning-dim)", borderBottom: "1px solid var(--warning-border)" }}>
          <div className="min-w-0">
            <p className="text-xs font-medium" style={{ color: "var(--warning)" }}>重要公告</p>
            <h2 id="important-announcement-title" className="truncate text-lg font-semibold">
              {item.title}
            </h2>
          </div>
          <button type="button" className="topbar-icon-btn flex-shrink-0" onClick={dismiss} aria-label="關閉重要公告">
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
          <a
            href={target}
            className="btn btn-primary"
            target={opensExternal ? "_blank" : undefined}
            rel={opensExternal ? "noreferrer" : undefined}
            onClick={dismiss}
          >
            {targetLabel}
          </a>
        </div>
      </section>
    </div>
  );
}
