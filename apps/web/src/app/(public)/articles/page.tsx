import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpenText, Clock3 } from "lucide-react";
import type { Metadata } from "next";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { articleReadingTime } from "@/lib/article-utils";
import { uploadUrl } from "@/lib/config";
import { publicPageHref } from "@/lib/publicNav";
import { fetchPublicPages, fetchPublicShellData } from "@/lib/serverFetch";
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
    fetchPublicPages(),
  ]);
  const articles = pages.filter((page) => page.page_kind === "article");
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
          <div>
            <p className="public-articles-mark"><BookOpenText size={16} aria-hidden /> 校園專刊</p>
            <h1>歡迎瀏覽資訊專刊</h1>
          </div>
          <p className="public-articles-intro">
            這裡整理給竹中人的生活指南與公共資訊
          </p>
        </header>

        {featured ? (
          <section className="public-article-feature" aria-labelledby="featured-article-title">
            <div className="public-article-feature-media">
              {featuredCoverUrl ? (
                <Image
                  src={featuredCoverUrl}
                  alt={featured.cover_image_alt || featured.title}
                  fill
                  unoptimized
                  sizes="(min-width: 900px) 50vw, 100vw"
                />
              ) : (
                <div className="public-article-cover-placeholder" aria-hidden="true">
                  <BookOpenText size={42} strokeWidth={1.4} />
                  <span>首篇文章</span>
                </div>
              )}
            </div>
            <div className="public-article-feature-copy">
              <p className="public-article-label">最新文章</p>
              <h2 id="featured-article-title"><Link href={publicPageHref(featured)}>{featured.title}</Link></h2>
              {featured.summary && <p className="public-article-summary">{featured.summary}</p>}
              <div className="public-article-meta">
                <time dateTime={featured.updated_at}>{new Date(featured.updated_at).toLocaleDateString("zh-TW")}</time>
                <span aria-hidden="true">·</span>
                <span><Clock3 size={14} aria-hidden /> 約 {articleReadingTime(featured.body_md)} 分鐘</span>
              </div>
              <Link href={publicPageHref(featured)} className="public-article-read-link">
                閱讀這篇文章 <ArrowRight size={17} aria-hidden />
              </Link>
            </div>
          </section>
        ) : (
          <section className="public-articles-empty" aria-labelledby="articles-empty-title">
            <BookOpenText size={26} aria-hidden />
            <div>
              <h2 id="articles-empty-title">文章專欄準備中</h2>
              <p>目前尚無已發布文章</p>
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
                  <time dateTime={article.updated_at}>{new Date(article.updated_at).toLocaleDateString("zh-TW")}</time>
                  <span><Clock3 size={13} aria-hidden /> {articleReadingTime(article.body_md)} 分鐘</span>
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
