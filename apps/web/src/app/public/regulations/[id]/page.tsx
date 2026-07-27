import type { Metadata } from "next";
import { notFound } from "next/navigation";

import MarkdownBlock from "@/components/site/MarkdownBlock";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicBundle } from "@/lib/serverFetch";
import { fetchPublicRegulation } from "@/lib/publicSeoFetch";
import { JsonLd, absoluteUrl, excerpt, pageMetadata } from "@/lib/seo";

function commonRegulationTitle(title: string): string {
  return title
    .replaceAll("國立新竹高級中學", "新竹高中")
    .replaceAll("班級聯合自治會", "班聯會");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const regulation = await fetchPublicRegulation(id);
  const title = regulation?.title ?? "公開法規";
  const commonTitle = commonRegulationTitle(title);
  return pageMetadata({
    title,
    description: `${commonTitle}｜${excerpt(
      regulation?.preface ?? regulation?.content,
      "新竹高中班聯會公開法規。",
    )}`,
    path: `/public/regulations/${encodeURIComponent(id)}`,
  });
}

export default async function PublicRegulationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [bundle, regulation] = await Promise.all([
    fetchPublicBundle(),
    fetchPublicRegulation(id),
  ]);
  if (!regulation) notFound();

  const path = `/public/regulations/${encodeURIComponent(id)}`;
  const commonTitle = commonRegulationTitle(regulation.title);
  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "Legislation",
            name: regulation.title,
            headline: regulation.title,
            alternateName: commonTitle !== regulation.title ? commonTitle : undefined,
            description: excerpt(regulation.preface ?? regulation.content, "公開法規。"),
            datePublished: regulation.published_at,
            dateModified: regulation.updated_at,
            version: String(regulation.version),
            url: absoluteUrl(path),
            isPartOf: { "@type": "CollectionPage", name: "公開法規資料庫" },
          }}
        />
        <article>
          <header className="public-page-head mb-8">
            <p className="public-section-kicker">Public Regulation</p>
            <h1 className="mt-2 text-3xl font-bold">{regulation.title}</h1>
            {commonTitle !== regulation.title && (
              <p className="mt-2 text-sm text-[var(--public-secondary)]">常用名稱：{commonTitle}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--public-secondary)]">
              <span>版本 {regulation.version}</span>
              {regulation.effective_date && <span>生效日 {regulation.effective_date}</span>}
              {regulation.published_at && (
                <span>發布於 {new Date(regulation.published_at).toLocaleDateString("zh-TW")}</span>
              )}
            </div>
          </header>
          {regulation.preface && (
            <p className="mb-6 rounded-xl border border-[var(--public-border)] bg-[var(--public-soft)] p-5 leading-8">
              {regulation.preface}
            </p>
          )}
          <div className="rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] p-6 sm:p-8">
            {regulation.articles?.length ? (
              <div className="space-y-7">
                {regulation.articles
                  .filter((article) => !article.is_deleted)
                  .sort((a, b) => a.sort_index - b.sort_index)
                  .map((article) => (
                    <section key={article.id}>
                      <h2 className="text-lg font-semibold">
                        {[article.legal_number, article.title].filter(Boolean).join(" ")}
                      </h2>
                      {article.subtitle && (
                        <p className="mt-1 text-sm text-[var(--public-secondary)]">{article.subtitle}</p>
                      )}
                      <p className="mt-2 whitespace-pre-wrap leading-8">{article.content}</p>
                    </section>
                  ))}
              </div>
            ) : (
              <MarkdownBlock markdown={regulation.content} />
            )}
          </div>
          {regulation.legislative_history && (
            <section className="mt-6 rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] p-6">
              <h2 className="text-lg font-semibold">沿革</h2>
              <p className="mt-3 whitespace-pre-wrap leading-8">{regulation.legislative_history}</p>
            </section>
          )}
        </article>
      </div>
    </PublicSiteShell>
  );
}
