"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { announcementsApi } from "@/lib/api";
import { useLowDataMode } from "@/hooks/useLowDataMode";
import { usePublicWS } from "@/hooks/usePublicWS";
import type { AnnouncementOut } from "@/lib/types";

const AnnouncementMarkdown = dynamic(() => import("./AnnouncementMarkdown"), {
  loading: () => <p role="status">正在載入公告內容…</p>,
});

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

function urgentDismissalKey(item: AnnouncementOut) {
  return `urgent-announcement:${item.id}:${item.updated_at}`;
}

function hasDismissedUrgent(item: AnnouncementOut) {
  if (typeof window === "undefined") return false;
  try {
    const storage = item.show_on_every_visit ? sessionStorage : localStorage;
    return storage.getItem(urgentDismissalKey(item)) === "dismissed";
  } catch {
    return false;
  }
}

function rememberUrgentDismissal(item: AnnouncementOut) {
  if (typeof window === "undefined") return;
  try {
    const storage = item.show_on_every_visit ? sessionStorage : localStorage;
    storage.setItem(urgentDismissalKey(item), "dismissed");
  } catch {
    /* storage quota or private mode */
  }
}

export default function UrgentAnnouncementPopup() {
  const [item, setItem] = useState<AnnouncementOut | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const lowDataMode = useLowDataMode();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let mounted = true;
    const cached = lowDataMode ? readUrgentCache() : null;
    if (cached) {
      if (cached.item && !hasDismissedUrgent(cached.item)) {
        setItem(cached.item);
        setOpen(true);
      }
      return () => { mounted = false; };
    }
    announcementsApi.activeUrgent()
      .then((announcement) => {
        if (!mounted) return;
        writeUrgentCache(announcement);
        if (!announcement) return;
        if (hasDismissedUrgent(announcement)) return;
        setItem(announcement);
        setOpen(true);
      })
      .catch(() => { /* public best-effort popup */ });
    return () => { mounted = false; };
  }, [lowDataMode]);

  usePublicWS("/public/announcements", () => {
    void announcementsApi.refreshActiveUrgent().then((announcement) => {
      if (!announcement || hasDismissedUrgent(announcement)) {
        setItem(null);
        setOpen(false);
        return;
      }
      writeUrgentCache(announcement);
      setItem(announcement);
      setOpen(true);
    }).catch(() => undefined);
  }, !lowDataMode);

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // 原生 modal dialog 會限制背景焦點；關閉時把焦點還給開啟前的控制項。
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    const focusFrame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      cancelAnimationFrame(focusFrame);
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!mounted || !item || !open) return null;

  const dismiss = () => {
    rememberUrgentDismissal(item);
    setOpen(false);
  };

  const target = item.link_url || `/announcements/${item.id}`;
  const targetLabel = item.link_label || (item.link_url ? "前往連結" : "查看公告");
  const opensExternal = /^https?:\/\//.test(target);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-[140] m-0 flex h-dvh w-screen max-h-none max-w-none items-center justify-center overflow-y-auto border-0 bg-transparent p-3 backdrop:bg-[var(--bg-overlay)] sm:p-4"
      aria-labelledby="important-announcement-title"
      onCancel={(event) => { event.preventDefault(); dismiss(); }}
      onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}
    >
      <section className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-lg max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)]"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--warning-border)", boxShadow: "var(--shadow-xl)" }}>
        <div className="flex items-center justify-between gap-3 px-5 py-3"
          style={{ background: "var(--warning-dim)", borderBottom: "1px solid var(--warning-border)" }}>
          <div className="min-w-0">
            <p className="text-xs font-medium" style={{ color: "var(--warning)" }}>重要公告</p>
            <h2 id="important-announcement-title" className="break-words text-lg font-semibold leading-snug">
              {item.title}
            </h2>
          </div>
          <button ref={closeButtonRef} type="button" className="topbar-icon-btn flex-shrink-0" onClick={dismiss} aria-label="關閉重要公告">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="max-h-[55dvh] overflow-y-auto p-4 sm:max-h-[62vh] sm:p-5">
          <AnnouncementMarkdown content={item.content} />
          <div className="mt-6 border-t pt-4 text-sm"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
            公告人：{item.author_name || "未命名"}
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:justify-end sm:px-5 sm:py-4" style={{ borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost w-full justify-center sm:w-auto" onClick={dismiss}>稍後再看</button>
          <a
            href={target}
            className="btn btn-primary w-full justify-center sm:w-auto"
            target={opensExternal ? "_blank" : undefined}
            rel={opensExternal ? "noreferrer" : undefined}
            onClick={dismiss}
          >
            {targetLabel}
          </a>
        </div>
      </section>
    </dialog>
    , document.body,
  );
}
