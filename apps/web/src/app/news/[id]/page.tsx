"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import AnnouncementMarkdown from "@/components/announcements/AnnouncementMarkdown";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { announcementsApi, siteApi } from "@/lib/api";
import type { AnnouncementOut, PublicSiteBundleOut } from "@/lib/types";

export default function NewsDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [site, setSite] = useState<PublicSiteBundleOut | null>(null);
  const [item, setItem] = useState<AnnouncementOut | null>(null);

  useEffect(() => {
    siteApi.public().then(setSite).catch(() => setSite(null));
    announcementsApi.get(id).then(setItem).catch(() => setItem(null));
  }, [id]);

  return (
    <PublicSiteShell navPages={site?.nav_pages ?? []}>
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link href="/news" className="btn btn-ghost mb-6">返回公告</Link>
        {!item ? (
          <div className="card p-10 text-center text-sm text-[var(--text-muted)]">找不到公告</div>
        ) : (
          <>
            <header className="mb-6">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                {item.is_urgent && (
                  <span className="badge border-[var(--danger-border)] bg-[var(--danger-dim)] text-[var(--danger)]">
                    緊急公告
                  </span>
                )}
                <time>{new Date(item.published_at ?? item.created_at).toLocaleString("zh-TW")}</time>
              </div>
              <h1 className="text-3xl font-bold leading-tight">{item.title}</h1>
              <p className="mt-3 text-sm text-[var(--text-muted)]">公告人：{item.author_name || "未命名"}</p>
            </header>
            <section className="card p-5 md:p-7">
              <AnnouncementMarkdown content={item.content} />
            </section>
          </>
        )}
      </article>
    </PublicSiteShell>
  );
}
