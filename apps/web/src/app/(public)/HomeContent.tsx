import Link from "next/link";
import { ArrowRight, ShoppingBag } from "lucide-react";

import LiveElectionCard from "@/components/site/LiveElectionCard";
import PublicLoadFailure from "@/components/site/PublicLoadFailure";
import ShopImage from "@/components/shop/ShopImage";
import { uploadUrl } from "@/lib/config";
import { isAnnouncementExpired } from "@/lib/announcement-expiration";
import { publicPageHref, resolvePublicNav } from "@/lib/publicNav";
import type {
  AnnouncementListItem,
  AnnouncementOut,
  CatalogCategoryOut,
  PublicSiteBundleOut,
  SurveyListItem,
} from "@/lib/types";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function HomeEntrySection({ bundle }: { bundle: PublicSiteBundleOut | null }) {
  const serviceKeys = new Set(["public-db", "petitions", "officers", "contact"]);
  const services = resolvePublicNav(bundle?.settings?.theme_config)
    .filter((item) => serviceKeys.has(item.key) && !item.hidden)
    .sort((a, b) => a.order - b.order);

  if (services.length === 0) return null;

  return (
    <section className="campus-services" aria-labelledby="campus-services-title">
      <h2 id="campus-services-title">常用服務</h2>
      <nav aria-label="校園常用服務">
        {services.map((item) => (
          <Link key={item.key} href={item.href}>
            {item.label}<ArrowRight size={18} aria-hidden />
          </Link>
        ))}
      </nav>
    </section>
  );
}

export default function HomeContent({
  bundle,
  announcements,
  announcementsAvailable = true,
  urgentAnnouncement,
  openSurveys,
  catalog,
  shopUnavailable,
}: {
  bundle: PublicSiteBundleOut | null;
  announcements: AnnouncementListItem[];
  announcementsAvailable?: boolean;
  urgentAnnouncement: AnnouncementOut | null;
  openSurveys: SurveyListItem[];
  catalog: CatalogCategoryOut[] | null;
  shopUnavailable: boolean;
}) {
  const urgent = urgentAnnouncement && !isAnnouncementExpired(urgentAnnouncement)
    ? urgentAnnouncement
    : null;
  const latestAnnouncements = announcements
    .filter((item) => item.id !== urgent?.id && !isAnnouncementExpired(item))
    .sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at))
    .slice(0, 4);
  const articles = (bundle?.nav_pages ?? [])
    .filter((page) => page.page_kind === "article")
    .slice()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 3);
  const featuredProducts = Array.from(new Map((catalog ?? [])
    .flatMap((category) => [
      ...category.products,
      ...category.series.flatMap((series) => series.products),
    ].map((product) => ({ ...product, categoryName: category.name })))
    .filter((product) => product.status === "active")
    .map((product) => [product.id, product])).values()).slice(0, 3);

  return (
    <div className="campus-content">
      <section className="campus-news" aria-labelledby="campus-news-title">
        <div className="campus-section-heading">
          <h2 id="campus-news-title">校園近況</h2>
          <Link href="/news">全部公告<ArrowRight size={16} aria-hidden /></Link>
        </div>
        <div className="campus-news-layout">
          <div>
            {urgent && (
              <article className="campus-news-lead">
                <div className="campus-meta">
                  <span className="campus-status">重要</span>
                  <time dateTime={urgent.published_at ?? urgent.created_at}>
                    {formatDate(urgent.published_at ?? urgent.created_at)}
                  </time>
                </div>
                <h3><Link href={urgent.link_url?.trim() || `/news/${urgent.id}`}>
                  {urgent.title}<ArrowRight size={22} aria-hidden />
                </Link></h3>
              </article>
            )}
            {latestAnnouncements.length > 0 ? (
              <ul className="campus-news-list">
                {latestAnnouncements.map((item) => (
                  <li key={item.id}>
                    <Link href={`/news/${item.id}`}>
                      <time dateTime={item.published_at ?? item.created_at}>
                        {formatDate(item.published_at ?? item.created_at)}
                      </time>
                      <span>{item.title}</span>
                      <ArrowRight size={17} aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : announcementsAvailable && !urgent && <p className="campus-empty">目前沒有新公告</p>}
            {!announcementsAvailable && <PublicLoadFailure message="無法取得最新公告" />}
          </div>
          <aside className="campus-participation" aria-label="校園參與">
            <LiveElectionCard />
            {openSurveys.slice(0, 2).map((survey) => (
              <Link key={survey.id} href={`/surveys/${encodeURIComponent(survey.title)}`} className="campus-survey">
                <span className="campus-meta">
                  {survey.closes_at ? `填答至 ${formatDate(survey.closes_at)}` : "開放填答"}
                </span>
                <strong>{survey.title}</strong><ArrowRight size={18} aria-hidden />
              </Link>
            ))}
          </aside>
        </div>
      </section>

      {articles.length > 0 && (
        <section className="campus-stories" aria-labelledby="campus-stories-title">
          <div className="campus-section-heading">
            <h2 id="campus-stories-title">文章專欄</h2>
            <Link href="/articles">全部文章<ArrowRight size={16} aria-hidden /></Link>
          </div>
          <div className="campus-stories-layout">
            {articles.map((article, index) => (
              <article key={article.id} className={index === 0 ? "campus-story campus-story-lead" : "campus-story"}>
                <time className="campus-meta" dateTime={article.updated_at}>
                  更新 {formatDate(article.updated_at)}
                </time>
                <h3><Link href={publicPageHref(article)}>{article.title}</Link></h3>
                {index === 0 && article.summary && <p>{article.summary}</p>}
              </article>
            ))}
          </div>
        </section>
      )}

      {!shopUnavailable && featuredProducts.length > 0 && (
        <section className="campus-shop" aria-labelledby="campus-shop-title">
          <div className="campus-section-heading">
            <h2 id="campus-shop-title">活動商品</h2>
            <Link href="/shop">商品目錄<ArrowRight size={16} aria-hidden /></Link>
          </div>
          <div className="campus-product-grid">
            {featuredProducts.map((product) => {
              const imageUrl = uploadUrl(product.image_url);
              return (
                <Link key={product.id} href={`/shop?product=${product.id}`} className="campus-product">
                  <span className="campus-product-image">
                    {imageUrl ? <ShopImage src={imageUrl} alt="" width={640} height={480}
                      sizes="(max-width: 639px) 44vw, (max-width: 1152px) 30vw, 360px" loading="lazy" />
                      : <ShoppingBag size={32} aria-hidden />}
                  </span>
                  <span className="campus-meta">{product.categoryName}</span>
                  <strong>{product.name}</strong>
                  <span className="campus-product-price">NT$ {product.price.toLocaleString("zh-TW")}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
