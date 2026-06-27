import { notFound } from "next/navigation";

import AnnouncementMarkdown from "@/components/announcements/AnnouncementMarkdown";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchAnnouncement, fetchPublicBundle } from "@/lib/serverFetch";

export default async function PublicNewsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [bundle, item] = await Promise.all([
    fetchPublicBundle(),
    fetchAnnouncement(id),
  ]);

  if (!item) notFound();

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <article className="space-y-5">
          <header className="public-page-head space-y-3">
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
          <div className="card p-5 md:p-7" data-reveal style={{ "--reveal-delay": "120ms" } as React.CSSProperties}>
            <AnnouncementMarkdown content={item.content} />
          </div>
        </article>
      </div>
    </PublicSiteShell>
  );
}
