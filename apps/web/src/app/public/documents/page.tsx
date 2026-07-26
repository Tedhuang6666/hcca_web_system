import type { Metadata } from "next";
import Link from "next/link";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicBundle } from "@/lib/serverFetch";
import { fetchPublicDocuments } from "@/lib/publicSeoFetch";
import { JsonLd, absoluteUrl, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "公開公文資料庫",
  description: "查詢新竹高中班聯會公開公文、發文字號、主旨與附件。",
  path: "/public/documents",
  type: "website",
});

export default async function PublicDocumentsPage() {
  const [bundle, documents] = await Promise.all([
    fetchPublicBundle(),
    fetchPublicDocuments(),
  ]);

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "公開公文資料庫",
            description: "新竹高中班聯會公開公文與附件。",
            url: absoluteUrl("/public/documents"),
          }}
        />
        <header className="public-page-head mb-8">
          <p className="public-section-kicker">Public Documents</p>
          <h1 className="mt-2 text-3xl font-bold">公開公文資料庫</h1>
          <p className="mt-3 max-w-2xl text-base leading-8 text-[var(--public-secondary)]">
            只列出已設定為公開的公文。每筆公文都有可直接分享與引用的固定頁面。
          </p>
        </header>
        <div className="overflow-hidden rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)]">
          <div className="hidden grid-cols-[12rem_minmax(0,1fr)_9rem] gap-4 border-b border-[var(--public-border)] bg-[var(--public-soft)] px-5 py-3 text-xs font-semibold text-[var(--public-muted)] sm:grid">
            <span>發文字號</span><span>標題／主旨</span><span>日期</span>
          </div>
          {documents.map((document) => (
            <article key={document.id} className="grid gap-2 border-b border-[var(--public-border)] px-5 py-4 last:border-0 sm:grid-cols-[12rem_minmax(0,1fr)_9rem] sm:gap-4">
              <span className="text-sm font-semibold text-[var(--public-accent)]">{document.serial_number || "未編號"}</span>
              <div>
                <Link href={`/public/documents/${encodeURIComponent(document.id)}`} className="font-semibold hover:text-[var(--public-accent)]">
                  {document.title}
                </Link>
                {document.subject && <p className="mt-1 text-sm leading-6 text-[var(--public-secondary)]">{document.subject}</p>}
              </div>
              <time dateTime={document.submitted_at ?? document.created_at} className="text-sm text-[var(--public-secondary)]">
                {new Date(document.submitted_at ?? document.created_at).toLocaleDateString("zh-TW")}
              </time>
            </article>
          ))}
          {documents.length === 0 && <p className="p-8 text-center text-[var(--public-secondary)]">目前沒有可公開查詢的公文。</p>}
        </div>
      </div>
    </PublicSiteShell>
  );
}
