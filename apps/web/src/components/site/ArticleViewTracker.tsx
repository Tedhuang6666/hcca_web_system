"use client";

import { useEffect, useRef } from "react";

import { analyticsApi } from "@/lib/api/analytics";

const VISITOR_ID_KEY = "hcca-public-visitor-id";

function createVisitorId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function getVisitorId(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_ID_KEY);
    if (existing && existing.length >= 16) return existing;
    const next = createVisitorId();
    window.localStorage.setItem(VISITOR_ID_KEY, next);
    return next;
  } catch {
    return createVisitorId();
  }
}

function getDeviceClass(): "mobile" | "tablet" | "desktop" {
  if (window.innerWidth < 768) return "mobile";
  if (window.innerWidth < 1024) return "tablet";
  return "desktop";
}

export default function ArticleViewTracker({ slug }: { slug: string }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void analyticsApi.trackArticleView(slug, getVisitorId(), getDeviceClass()).catch(() => undefined);
  }, [slug]);

  return null;
}
