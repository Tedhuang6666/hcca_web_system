import Link from "next/link";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchAnnouncements, fetchPublicBundle } from "@/lib/serverFetch";

export default async function NewsPage() {
  const [bundle, items] = await Promise.all([
    fetchPublicBundle(),
    fetchAnnouncements(100),
  ]);

  const sorted = [...items].sort((a, b) =>
    (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at),
  );

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <header className="public-page-head mb-8">
          <p className="public-section-kicker">News</p>
          <h1 className="mt-2 text-3xl font-bold">最新公告</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
            對外公開的班聯會公告、活動消息與重要通知。
          </p>
        </header>
        <div className="space-y-3">
          {sorted.map((item, i) => (
            <Link
              key={item.id}
              href={`/news/${item.id}`}
              className="card card-hover block p-5 no-underline"
              data-reveal
              style={{ "--reveal-delay": `${Math.min(i, 8) * 55}ms` } as React.CSSProperties}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                {item.is_urgent && (
                  <span className="badge" style={{ color: "var(--warning)", background: "var(--warning-dim)", borderColor: "var(--warning-border)" }}>
                    重要
                  </span>
                )}
                <time dateTime={item.published_at ?? item.created_at}>
                  {new Date(item.published_at ?? item.created_at).toLocaleDateString("zh-TW")}
                </time>
              </div>
              <h2 className="mt-2 text-lg font-semibold leading-snug text-[var(--text-primary)]">
                {item.title}
              </h2>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                公告人：{item.author_name || "未命名"}
              </p>
            </Link>
          ))}
          {sorted.length === 0 && (
            <div className="card p-10 text-center text-sm text-[var(--text-muted)]">
              目前沒有公開公告
            </div>
          )}
        </div>
      </div>
    </PublicSiteShell>
  );
}
