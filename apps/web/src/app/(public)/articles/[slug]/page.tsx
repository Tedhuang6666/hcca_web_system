import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, BookOpenText, Clock3, List } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ArticleMarkdown from "@/components/site/ArticleMarkdown";
import ArticleViewTracker from "@/components/site/ArticleViewTracker";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { articleReadingTime, extractArticleHeadings } from "@/lib/article-utils";
import { BRANDING } from "@/lib/branding";
import { uploadUrl } from "@/lib/config";
import { fetchPublicPage, fetchPublicShellData } from "@/lib/serverFetch";
import { breadcrumbJsonLd, organizationJsonLd } from "@/lib/structured-data";
import { JsonLd, absoluteUrl, excerpt, pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = await fetchPublicPage(slug);
  if (!page || page.page_kind !== "article") return {};

  return pageMetadata({
    title: page.seo_title || page.title,
    description: page.seo_description || page.summary || excerpt(page.body_md, "校園文章。"),
    path: `/articles/${encodeURIComponent(slug)}`,
    type: "article",
    imagePath: uploadUrl(page.cover_image_url) || undefined,
  });
}

export default async function ArticleDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [{ bundle, urgentAnnouncement }, page] = await Promise.all([
    fetchPublicShellData(),
    fetchPublicPage(slug),
  ]);

  if (!page || page.page_kind !== "article") notFound();

  const path = `/articles/${encodeURIComponent(slug)}`;
  const canonical = absoluteUrl(path);
  const coverImageUrl = uploadUrl(page.cover_image_url);
  const headings = extractArticleHeadings(page.body_md, [2]);
  const readingTime = articleReadingTime(page.body_md);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          "@id": canonical,
          headline: page.title,
          description: page.seo_description || page.summary || excerpt(page.body_md, "校園文章。"),
          datePublished: page.created_at,
          dateModified: page.updated_at,
          author: { "@type": "Organization", name: BRANDING.orgShortName },
          publisher: organizationJsonLd(),
          mainEntityOfPage: canonical,
          image: coverImageUrl ? absoluteUrl(coverImageUrl) : undefined,
        }}
      />
      <JsonLd data={breadcrumbJsonLd([
        { name: "首頁", url: absoluteUrl("/") },
        { name: "文章專欄", url: absoluteUrl("/articles") },
        { name: page.title, url: canonical },
      ])} />

      <PublicSiteShell
        navPages={bundle?.nav_pages ?? []}
        settings={bundle?.settings}
        urgentAnnouncement={urgentAnnouncement}
      >
        <ArticleViewTracker slug={slug} />
        <div className="public-article-detail">
          <Link href="/articles" className="public-article-back"><ArrowLeft size={16} aria-hidden /> 返回文章專欄</Link>

          <header className="public-article-detail-header">
            <div className="public-article-detail-copy">
              <p className="public-articles-mark"><BookOpenText size={16} aria-hidden /> 校園文章</p>
              <h1>{page.title}</h1>
              {page.summary && <p className="public-article-detail-summary">{page.summary}</p>}
              <div className="public-article-meta">
                <time dateTime={page.updated_at}>更新於 {new Date(page.updated_at).toLocaleDateString("zh-TW")}</time>
                <span aria-hidden="true">·</span>
                <span><Clock3 size={14} aria-hidden /> 約 {readingTime} 分鐘閱讀</span>
              </div>
            </div>
            {coverImageUrl && (
              <div className="public-article-detail-cover">
                <Image
                  src={coverImageUrl}
                  alt={page.cover_image_alt || page.title}
                  fill
                  unoptimized
                  priority
                  sizes="(min-width: 900px) 38vw, 100vw"
                />
              </div>
            )}
          </header>

          <div className="public-article-reading-layout">
            {headings.length > 0 && (
              <aside className="public-article-toc" aria-label="文章段落目錄">
                <div className="public-article-toc-heading"><List size={16} aria-hidden /> 文章段落</div>
                <nav>
                  {headings.map((heading) => (
                    <a key={heading.id} href={`#${heading.id}`} className={heading.level === 3 ? "is-subsection" : undefined}>
                      {heading.label}
                    </a>
                  ))}
                </nav>
              </aside>
            )}
            <article className="public-article-body">
              <ArticleMarkdown markdown={page.body_md} skipFirstTitle />
            </article>
          </div>
        </div>
      </PublicSiteShell>
    </>
  );
}
