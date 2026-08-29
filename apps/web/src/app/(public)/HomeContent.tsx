import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  Database,
  FileText,
  Megaphone,
  MessageCircle,
  UsersRound,
} from "lucide-react";

import LiveElectionCard from "@/components/site/LiveElectionCard";
import { publicPageHref } from "@/lib/publicNav";
import type {
  AnnouncementListItem,
  AnnouncementOut,
  PublicSiteBundleOut,
  SurveyListItem,
} from "@/lib/types";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

export default function HomeContent({
  bundle,
  announcements,
  urgentAnnouncement,
  openSurveys,
}: {
  bundle: PublicSiteBundleOut | null;
  announcements: AnnouncementListItem[];
  urgentAnnouncement: AnnouncementOut | null;
  openSurveys: SurveyListItem[];
}) {
  const settings = bundle?.settings;
  const openSurvey = openSurveys[0] ?? null;
  const latestAnnouncements = announcements
    .filter((item) => item.id !== urgentAnnouncement?.id)
    .slice(0, 2);
  const recentlyUpdatedPages = [...(bundle?.nav_pages ?? [])]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 2);
  const publicDatabaseDescription = settings?.public_database_description?.trim();
  const hasLatestContent = latestAnnouncements.length > 0 || recentlyUpdatedPages.length > 0;
  const nowItems = [
    urgentAnnouncement && {
      href: urgentAnnouncement.link_url?.trim() || `/news/${urgentAnnouncement.id}`,
      label: "重要公告",
      title: urgentAnnouncement.title,
      detail: "請先查看這則重要公告",
      icon: Megaphone,
    },
    openSurvey && {
      href: `/surveys/${encodeURIComponent(openSurvey.title)}`,
      label: "開放填答",
      title: openSurvey.title,
      detail: openSurvey.closes_at ? `截止 ${formatDate(openSurvey.closes_at)}` : "正在收集意見",
      icon: UsersRound,
    },
    latestAnnouncements[0] && {
      href: `/news/${latestAnnouncements[0].id}`,
      label: "最新公告",
      title: latestAnnouncements[0].title,
      detail: `${formatDate(latestAnnouncements[0].published_at ?? latestAnnouncements[0].created_at)} 發布`,
      icon: BellRing,
    },
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <>
      {nowItems.length > 0 && (
        <section className="public-home-now-section" aria-labelledby="public-now-title" data-reveal>
          <div className="public-home-now-heading">
            <div>
              <h2 id="public-now-title">即時重點</h2>
              <p>同步目前最即時的更新</p>
            </div>
            <Link href="/news" className="public-text-link">查看全部公告</Link>
          </div>
          <div className="public-home-now-list">
            {nowItems.slice(0, 3).map((item) => {
              const Icon = item.icon;
              return (
                <Link key={`${item.label}-${item.href}`} href={item.href} className="public-home-now-row">
                  <span className="public-home-now-icon" aria-hidden="true"><Icon size={18} /></span>
                  <span className="min-w-0">
                    <span className="public-home-now-label">{item.label}</span>
                    <span className="public-home-now-title">{item.title}</span>
                  </span>
                  <span className="public-home-now-detail">{item.detail}</span>
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {hasLatestContent && (
        <section className="public-home-updates" aria-labelledby="public-updates-title" data-reveal>
          <div className="public-home-updates-heading">
            <div>
              <h2 id="public-updates-title">最近更新</h2>
              <p>公開資料會持續整理，方便你回來接著看。</p>
            </div>
            <Link href="/news" className="public-text-link">查看全部公告</Link>
          </div>

          <div className="public-home-updates-grid">
            <LiveElectionCard />
            <div className="public-home-update-list">
              <div className="public-home-update-list-heading">
                <BellRing size={18} aria-hidden />
                <h3>最新消息</h3>
              </div>
              <div>
                {latestAnnouncements.map((item) => (
                  <Link
                    key={item.id}
                    href={`/news/${item.id}`}
                    className="public-home-update-row"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        {item.title}
                      </span>
                      <time className="mt-1 block text-xs text-[var(--public-muted)]">
                        {formatDate(item.published_at ?? item.created_at)} 發布
                      </time>
                    </span>
                    <ArrowRight size={15} className="mt-1 shrink-0" aria-hidden />
                  </Link>
                ))}
                {recentlyUpdatedPages.map((page) => (
                  <Link
                    key={page.id}
                    href={publicPageHref(page)}
                    className="public-home-update-row"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        {page.title}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--public-muted)]">
                        {formatDate(page.updated_at)} 更新
                      </span>
                    </span>
                    <ArrowRight size={15} className="mt-1 shrink-0" aria-hidden />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {!hasLatestContent && nowItems.length === 0 && (
        <section className="public-home-empty" aria-labelledby="public-empty-title">
          <FileText size={22} aria-hidden />
          <div>
            <h2 id="public-empty-title">目前沒有新的校園動態</h2>
            <p>你仍可查看公開資料、填寫問卷，或提出意見陳情</p>
          </div>
          <Link href="/public" className="public-text-link">查詢公開資料</Link>
        </section>
      )}

      <section className="public-home-entry-section" aria-labelledby="public-entry-title">
        <div className="public-home-entry-heading">
          <h2 id="public-entry-title">所有校園服務</h2>
          <p>挑選想要查看的內容，所有資訊已整理在本數位系統中！</p>
        </div>
        <nav className="public-quick-grid public-home-quick-grid" aria-label="公開網站主要入口">
          {[
            {
              href: "/news",
              title: "最新公告",
              desc: "掌握最新消息",
              action: "查看公告",
              icon: Megaphone,
            },
            {
              href: "/articles",
              title: "文章專欄",
              desc: "校園生活指南與實用文章",
              action: "閱讀文章",
              icon: FileText,
            },
            {
              href: "/public",
              title: "公開資料",
              desc: publicDatabaseDescription || "法規、公文與治理紀錄",
              action: "查詢資料",
              icon: Database,
            },
            {
              href: "/surveys",
              title: "校園調查",
              desc: "填寫正在開放的問卷",
              action: "填寫調查",
              icon: UsersRound,
            },
            {
              href: "/petitions/new",
              title: "提出陳情",
              desc: "讓你的意見正式傳達",
              action: "提出陳情",
              icon: MessageCircle,
            },
          ].map((item, index) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="public-feature-card public-home-feature-card"
                data-entry={index}
              >
                <span className="public-home-card-wash" aria-hidden="true" />
                <span className="public-feature-icon"><Icon size={20} aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold">{item.title}</span>
                  <span className="mt-0.5 block text-sm text-[var(--public-secondary)]">
                    {item.desc}
                  </span>
                </span>
                <span className="public-home-card-action" aria-hidden="true">
                  {item.action}
                  <ArrowRight className="public-feature-arrow" size={17} />
                </span>
              </Link>
            );
          })}
        </nav>
      </section>
    </>
  );
}
