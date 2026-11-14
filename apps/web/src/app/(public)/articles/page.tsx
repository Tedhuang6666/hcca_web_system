import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import PublicLoadFailure from "@/components/site/PublicLoadFailure";
import { articleReadingTime } from "@/lib/article-utils";
import { uploadUrl } from "@/lib/config";
import { publicPageHref } from "@/lib/publicNav";
import { fetchPublicJson, fetchPublicShellData } from "@/lib/serverFetch";
import type { PublicSitePageOut } from "@/lib/types";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "文章專欄",
  description: "閱讀新竹高中校園生活指南、實用資訊與學生自治文章。",
  path: "/articles",
  type: "website",
});

export default async function ArticlesPage() {
  const [{ bundle, urgentAnnouncement }, pages] = await Promise.all([
    fetchPublicShellData(),
    fetchPublicJson<PublicSitePageOut[]>("/site/pages", { revalidate: 15 }),
  ]);
  const articles = (pages ?? []).filter((page) => page.page_kind === "article")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const [featured, ...rest] = articles;
  const featuredCoverUrl = featured ? uploadUrl(featured.cover_image_url) : "";

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={bundle?.settings}
      urgentAnnouncement={urgentAnnouncement}
    >
      <div className="public-articles-page">
        <header className="public-articles-heading">
          <h1>文章專欄</h1>
        </header>

        {pages === null ? <PublicLoadFailure message="無法取得文章列表" /> : featured ? (
          <section className={`public-article-feature${featuredCoverUrl ? "" : " public-article-feature-text"}`} aria-labelledby="featured-article-title">
            {featuredCoverUrl && (
            <div className="public-article-feature-media">
                <Image
                  src={featuredCoverUrl}
                  alt={featured.cover_image_alt || featured.title}
                  fill
                  unoptimized
                  sizes="(min-width: 900px) 50vw, 100vw"
                />
            </div>
            )}
            <div className="public-article-feature-copy">
              <h2 id="featured-article-title"><Link href={publicPageHref(featured)}>{featured.title}</Link></h2>
              {featured.summary && <p className="public-article-summary">{featured.summary}</p>}
              <div className="public-article-meta">
                <time dateTime={featured.updated_at}>更新 {new Date(featured.updated_at).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}</time>
                <span aria-hidden="true">·</span>
                <span>約 {articleReadingTime(featured.body_md)} 分鐘</span>
              </div>
              <Link href={publicPageHref(featured)} className="public-article-read-link">
                閱讀這篇文章 <ArrowRight size={17} aria-hidden />
              </Link>
            </div>
          </section>
        ) : (
          <section className="public-articles-empty" aria-labelledby="articles-empty-title">
            <div>
              <h2 id="articles-empty-title">目前尚無已發布文章</h2>
            </div>
          </section>
        )}

        {rest.length > 0 && (
          <section className="public-article-list" aria-labelledby="more-articles-title">
            <div className="public-article-list-heading">
              <h2 id="more-articles-title">更多文章</h2>
              <span>{rest.length} 篇</span>
            </div>
            {rest.map((article) => (
              <Link key={article.id} href={publicPageHref(article)} className="public-article-row">
                <span className="public-article-row-date">
                  <time dateTime={article.updated_at}>更新 {new Date(article.updated_at).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}</time>
                  <span>{articleReadingTime(article.body_md)} 分鐘</span>
                </span>
                <span className="min-w-0">
                  <strong>{article.title}</strong>
                  {article.summary && <span>{article.summary}</span>}
                </span>
                <ArrowRight className="public-article-row-arrow" size={18} aria-hidden />
              </Link>
            ))}
          </section>
        )}
      </div>
    </PublicSiteShell>
  );
}
