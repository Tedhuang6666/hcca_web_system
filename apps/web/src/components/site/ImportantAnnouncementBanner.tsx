"use client";

import { AlertTriangle, ArrowRight, X } from "lucide-react";
import { useEffect, useState } from "react";

import { announcementsApi } from "@/lib/api";
import type { AnnouncementOut } from "@/lib/types";

const DISMISSAL_TTL_MS = 10 * 60 * 1000;

function dismissalKey(item: AnnouncementOut) {
  return `hcca:public-important-announcement:${item.id}:${item.updated_at}`;
}

function wasRecentlyDismissed(item: AnnouncementOut) {
  if (typeof window === "undefined") return false;

  try {
    const raw = window.localStorage.getItem(dismissalKey(item));
    const dismissedAt = raw ? Number(raw) : NaN;
    if (!Number.isFinite(dismissedAt)) return false;
    if (Date.now() - dismissedAt >= DISMISSAL_TTL_MS) {
      window.localStorage.removeItem(dismissalKey(item));
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function rememberDismissal(item: AnnouncementOut) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(dismissalKey(item), String(Date.now()));
  } catch {
    // 儲存空間受限或無痕模式下，關閉仍應只影響目前畫面。
  }
}

export default function ImportantAnnouncementBanner({
  announcement: initialAnnouncement,
}: {
  announcement?: AnnouncementOut | null;
}) {
  const [announcement, setAnnouncement] = useState<AnnouncementOut | null>(
    initialAnnouncement ?? null,
  );
  const [visible, setVisible] = useState(false);
  const [resolved, setResolved] = useState(initialAnnouncement !== undefined);

  useEffect(() => {
    let active = true;

    if (initialAnnouncement !== undefined) {
      setAnnouncement(initialAnnouncement);
      setVisible(Boolean(initialAnnouncement && !wasRecentlyDismissed(initialAnnouncement)));
      setResolved(true);
      return () => {
        active = false;
      };
    }

    setResolved(false);
    announcementsApi.activeUrgent()
      .then((item) => {
        if (!active) return;
        setAnnouncement(item);
        setVisible(Boolean(item && !wasRecentlyDismissed(item)));
        setResolved(true);
      })
      .catch(() => {
        if (!active) return;
        setAnnouncement(null);
        setResolved(true);
      });

    return () => {
      active = false;
    };
  }, [initialAnnouncement]);

  if (!resolved || !announcement || !visible) return null;

  const target = announcement.link_url?.trim() || `/news/${announcement.id}`;
  const opensExternal = /^https?:\/\//.test(target);
  const dismiss = () => {
    rememberDismissal(announcement);
    setVisible(false);
  };

  return (
    <div className="public-important-strip" role="region" aria-label="重要公告">
      <AlertTriangle className="public-important-strip-icon" size={18} aria-hidden />
      <a
        href={target}
        className="public-important-strip-link"
        target={opensExternal ? "_blank" : undefined}
        rel={opensExternal ? "noreferrer" : undefined}
      >
        <span className="public-important-strip-label">重要公告</span>
        <span className="public-important-strip-title">{announcement.title}</span>
        <span className="public-important-strip-cta">
          {announcement.link_label || (announcement.link_url ? "前往連結" : "查看公告")}
          <ArrowRight size={15} aria-hidden />
        </span>
      </a>
      <button
        type="button"
        className="public-important-strip-close"
        onClick={dismiss}
        aria-label="關閉重要公告，10 分鐘內不再顯示"
        title="關閉公告（10 分鐘內不再顯示）"
      >
        <X size={18} aria-hidden />
      </button>
    </div>
  );
}
