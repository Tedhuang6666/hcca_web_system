"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { merchandiseSubmissionsApi } from "@/lib/api";
import type { MerchandiseSubmissionSettingsOut } from "@/lib/types";

export default function MerchandiseSubmissionAnnouncementPopup() {
  const pathname = usePathname();
  const [settings, setSettings] = useState<MerchandiseSubmissionSettingsOut | null>(null);
  const [open, setOpen] = useState(false);
  const hasChecked = useRef(false);

  useEffect(() => {
    if (hasChecked.current) return;
    hasChecked.current = true;
    if (pathname.startsWith("/merchandise-submissions")) return;
    let mounted = true;
    merchandiseSubmissionsApi.portal()
      .then((portal) => {
        if (!mounted || !portal.settings.show_announcement_popup || !portal.settings.announcement?.trim()) return;
        setSettings(portal.settings);
        setOpen(true);
      })
      .catch(() => { /* 未登入時不顯示投稿公告。 */ });
    return () => { mounted = false; };
  }, [pathname]);

  if (!settings || !open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: "var(--bg-overlay)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="merchandise-submission-announcement-title"
    >
      <button type="button" className="absolute inset-0 cursor-default" onClick={() => setOpen(false)} aria-label="關閉投稿公告" />
      <section
        className="relative w-full max-w-xl rounded-lg border"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border-strong)", boxShadow: "var(--shadow-xl)" }}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--primary-text)" }}>校商投稿公告</p>
            <h2 id="merchandise-submission-announcement-title" className="mt-1 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              {settings.announcement_title || "校商投稿資訊"}
            </h2>
          </div>
          <button type="button" className="topbar-icon-btn" onClick={() => setOpen(false)} aria-label="關閉投稿公告"><X size={17} /></button>
        </header>
        <p className="whitespace-pre-wrap px-5 py-5 text-sm leading-6" style={{ color: "var(--text-secondary)" }}>{settings.announcement}</p>
        <footer className="flex justify-end gap-2 border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <button type="button" className="btn btn-ghost min-h-11" onClick={() => setOpen(false)}>稍後再看</button>
          <Link href="/merchandise-submissions" className="btn min-h-11" style={{ background: "var(--primary)", color: "var(--primary-fg)", border: "none" }} onClick={() => setOpen(false)}>
            前往校商投稿<ArrowRight size={16} aria-hidden="true" />
          </Link>
        </footer>
      </section>
    </div>
  );
}
