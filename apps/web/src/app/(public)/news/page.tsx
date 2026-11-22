import Link from "next/link";
import { ArrowRight } from "lucide-react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import PublicLoadFailure from "@/components/site/PublicLoadFailure";
import {
  fetchActiveUrgentAnnouncement,
  fetchPublicJson,
  fetchPublicBundle,
} from "@/lib/serverFetch";
import { pageMetadata } from "@/lib/seo";
import { isAnnouncementExpired } from "@/lib/announcement-expiration";
import type { AnnouncementListItem } from "@/lib/types";

export const metadata = pageMetadata({
  title: "最新公告",
  description: "新竹高中班聯會公開公告、活動消息與重要通知。",
  path: "/news",
  type: "website",
});

const dateFormatter = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei" });

export default async function NewsPage() {
  const [bundle, items, urgentAnnouncement] = await Promise.all([
    fetchPublicBundle(),
    fetchPublicJson<AnnouncementListItem[]>("/announcements?limit=100"),
    fetchActiveUrgentAnnouncement(),
  ]);
  const sorted = [...(items ?? [])].sort((a, b) =>
    (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at),
  );
  const featured = urgentAnnouncement && !isAnnouncementExpired(urgentAnnouncement)
    ? urgentAnnouncement
    : sorted.find((item) => item.is_urgent && !isAnnouncementExpired(item));
  const remaining = sorted.filter((item) => item.id !== featured?.id);

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings} urgentAnnouncement={null}>
      <div className="public-news-index">
        <header className="public-page-head"><h1>最新公告</h1></header>
        {featured && (
          <article className="public-news-feature">
            <div className="public-news-meta">
              <span className="public-news-status">重要</span>
              <time dateTime={featured.published_at ?? featured.created_at}>
                {dateFormatter.format(new Date(featured.published_at ?? featured.created_at))}
              </time>
            </div>
            <h2><Link href={`/news/${featured.id}`}>{featured.title}<ArrowRight size={24} aria-hidden /></Link></h2>
            {featured.author_name && <p className="public-news-author">{featured.author_name}</p>}
          </article>
        )}
        <ul className="public-news-list">
          {remaining.map((item) => (
            <li key={item.id}>
              <Link href={`/news/${item.id}`}>
                <time dateTime={item.published_at ?? item.created_at}>
                  {dateFormatter.format(new Date(item.published_at ?? item.created_at))}
                </time>
                <span className="public-news-row-copy">
                  <span className="public-news-row-heading">
                    <h2>{item.title}</h2>
                    {isAnnouncementExpired(item) ? <span className="public-news-meta">已過期</span>
                      : item.is_urgent && <span className="public-news-status">重要</span>}
                  </span>
                  {item.author_name && <span className="public-news-author">{item.author_name}</span>}
                </span>
                <ArrowRight size={18} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        {items === null ? <PublicLoadFailure message="無法取得公開公告" />
          : !featured && remaining.length === 0 && <p className="public-index-empty">目前沒有公開公告</p>}
      </div>
    </PublicSiteShell>
  );
}
