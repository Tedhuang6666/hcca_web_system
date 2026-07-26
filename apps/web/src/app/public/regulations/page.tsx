import type { Metadata } from "next";
import Link from "next/link";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicBundle } from "@/lib/serverFetch";
import { fetchPublicRegulations } from "@/lib/publicSeoFetch";
import { JsonLd, absoluteUrl, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "公開法規資料庫",
  description: "查詢新竹高中班聯會現行公開法規、發布日期與條文內容。",
  path: "/public/regulations",
  type: "website",
});

export default async function PublicRegulationsPage() {
  const [bundle, regulations] = await Promise.all([
    fetchPublicBundle(),
    fetchPublicRegulations(),
  ]);

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "公開法規資料庫",
            description: "新竹高中班聯會現行公開法規。",
            url: absoluteUrl("/public/regulations"),
            isPartOf: { "@type": "WebSite", name: "新竹高中班聯會" },
          }}
        />
        <header className="public-page-head mb-8">
          <p className="public-section-kicker">Public Regulations</p>
          <h1 className="mt-2 text-3xl font-bold">公開法規資料庫</h1>
          <p className="mt-3 max-w-2xl text-base leading-8 text-[var(--public-secondary)]">
            這裡列出已發布且目前有效的法規。每一筆資料都有獨立網址，方便引用與搜尋。
          </p>
        </header>
        <div className="grid gap-4">
          {regulations.map((regulation) => (
            <article
              key={regulation.id}
              className="rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] p-5"
            >
              <Link
                href={`/public/regulations/${encodeURIComponent(regulation.id)}`}
                className="text-xl font-semibold hover:text-[var(--public-accent)]"
              >
                {regulation.title}
              </Link>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--public-secondary)]">
                <span>版本 {regulation.version}</span>
                <span>更新於 {new Date(regulation.updated_at).toLocaleDateString("zh-TW")}</span>
                {regulation.published_at && (
                  <span>發布於 {new Date(regulation.published_at).toLocaleDateString("zh-TW")}</span>
                )}
              </div>
            </article>
          ))}
          {regulations.length === 0 && (
            <p className="rounded-2xl border border-[var(--public-border)] p-8 text-center text-[var(--public-secondary)]">
              目前沒有可公開查詢的法規。
            </p>
          )}
        </div>
      </div>
    </PublicSiteShell>
  );
}
