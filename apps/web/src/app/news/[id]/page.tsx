"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import AnnouncementMarkdown from "@/components/announcements/AnnouncementMarkdown";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { announcementsApi, siteApi } from "@/lib/api";
import type { AnnouncementOut, PublicSiteBundleOut } from "@/lib/types";

export default function PublicNewsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bundle, setBundle] = useState<PublicSiteBundleOut | null>(null);
  const [item, setItem] = useState<AnnouncementOut | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([siteApi.public(), announcementsApi.get(id)])
      .then(([nextBundle, nextItem]) => {
        setBundle(nextBundle);
        setItem(nextItem);
      })
      .catch(() => {
        setBundle(null);
        setItem(null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {loading ? (
          <div className="card p-10 text-center text-sm text-[var(--text-muted)]">載入中...</div>
        ) : !item ? (
          <div className="card p-10 text-center text-sm text-[var(--text-muted)]">找不到公告</div>
        ) : (
          <article className="space-y-5">
            <header className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                {item.is_urgent && (
                  <span className="badge" style={{ color: "var(--danger)", background: "var(--danger-dim)", borderColor: "var(--danger-border)" }}>
                    緊急公告
                  </span>
                )}
                <time dateTime={item.published_at ?? item.created_at}>
                  {new Date(item.published_at ?? item.created_at).toLocaleString("zh-TW")}
                </time>
              </div>
              <h1 className="text-3xl font-bold leading-tight">{item.title}</h1>
              <p className="text-sm text-[var(--text-muted)]">公告人：{item.author_name || "未命名"}</p>
            </header>
            <div className="card p-5 md:p-7">
              <AnnouncementMarkdown content={item.content} />
            </div>
          </article>
        )}
      </div>
    </PublicSiteShell>
  );
}
