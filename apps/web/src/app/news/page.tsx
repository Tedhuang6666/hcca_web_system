"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { announcementsApi, siteApi } from "@/lib/api";
import type { AnnouncementListItem, PublicSiteBundleOut } from "@/lib/types";

export default function NewsPage() {
  const [site, setSite] = useState<PublicSiteBundleOut | null>(null);
  const [items, setItems] = useState<AnnouncementListItem[]>([]);

  useEffect(() => {
    siteApi.public().then(setSite).catch(() => setSite(null));
    announcementsApi.list({ limit: 100 }).then(setItems).catch(() => setItems([]));
  }, []);

  const sorted = useMemo(
    () => [...items].sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at)),
    [items],
  );

  return (
    <PublicSiteShell navPages={site?.nav_pages ?? []}>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <header className="mb-8">
          <p className="text-sm font-semibold text-[var(--primary)]">News</p>
          <h1 className="mt-2 text-3xl font-bold">最新公告</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
            對外公開的班聯會消息、活動提醒與重要通知。
          </p>
        </header>
        <div className="space-y-3">
          {sorted.map((item) => (
            <Link key={item.id} href={`/news/${item.id}`} className="card card-hover block p-5 no-underline">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                {item.is_urgent && (
                  <span className="badge border-[var(--danger-border)] bg-[var(--danger-dim)] text-[var(--danger)]">
                    緊急
                  </span>
                )}
                <time>{new Date(item.published_at ?? item.created_at).toLocaleString("zh-TW")}</time>
              </div>
              <h2 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">{item.title}</h2>
              <p className="mt-2 text-sm text-[var(--text-muted)]">公告人：{item.author_name || "未命名"}</p>
            </Link>
          ))}
          {sorted.length === 0 && (
            <div className="card p-10 text-center text-sm text-[var(--text-muted)]">目前沒有公開公告</div>
          )}
        </div>
      </div>
    </PublicSiteShell>
  );
}
