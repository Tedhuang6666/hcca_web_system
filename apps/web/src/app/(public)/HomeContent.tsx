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
  const recentItems = [
    ...latestAnnouncements.map((item) => ({
      href: `/news/${item.id}`,
      label: "公告",
      title: item.title,
      detail: `${formatDate(item.published_at ?? item.created_at)} 發布`,
      timestamp: item.published_at ?? item.created_at,
      icon: BellRing,
      priority: false,
    })),
    ...recentlyUpdatedPages.map((page) => ({
      href: publicPageHref(page),
      label: "公開內容",
      title: page.title,
      detail: `${formatDate(page.updated_at)} 更新`,
      timestamp: page.updated_at,
      icon: FileText,
      priority: false,
    })),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const activityItems = [
    urgentAnnouncement && {
      href: urgentAnnouncement.link_url?.trim() || `/news/${urgentAnnouncement.id}`,
      label: "重要公告",
      title: urgentAnnouncement.title,
      detail: "請優先查看",
      icon: Megaphone,
      priority: true,
    },
    openSurvey && {
      href: `/surveys/${encodeURIComponent(openSurvey.title)}`,
      label: "開放填答",
      title: openSurvey.title,
      detail: openSurvey.closes_at ? `截止 ${formatDate(openSurvey.closes_at)}` : "正在收集意見",
      icon: UsersRound,
      priority: false,
    },
    ...recentItems,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const hasActivityContent = activityItems.length > 0;

  return (
    <>
      {hasActivityContent && (
        <section className="public-home-dynamics" aria-labelledby="public-dynamics-title" data-reveal>
          <div className="public-home-dynamics-heading">
            <div>
              <h2 id="public-dynamics-title">重要資訊</h2>
              <p>整合最近的重要更新，記得查看！</p>
            </div>
            <div className="public-home-dynamics-actions" aria-label="校園動態導覽">
              <Link href="/news" className="public-text-link">所有公告</Link>
              <Link href="/public" className="public-text-link">公開資料庫</Link>
            </div>
          </div>

          <div className="public-home-dynamics-layout">
            <div className="public-home-activity-feed">
              <div className="public-home-feed-heading">
                <BellRing size={18} aria-hidden />
                <h3>最新動態</h3>
                <span>{activityItems.length} 則</span>
              </div>
              <div>
                {activityItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={`${item.label}-${item.href}`}
                      href={item.href}
                      className="public-home-activity-row"
                      data-priority={item.priority ? "true" : undefined}
                    >
                      <span className="public-home-activity-icon" aria-hidden="true"><Icon size={17} /></span>
                      <span className="min-w-0">
                        <span className="public-home-activity-label">{item.label}</span>
                        <span className="public-home-activity-title">{item.title}</span>
                      </span>
                      <span className="public-home-activity-detail">{item.detail}</span>
                      <ArrowRight size={18} aria-hidden="true" />
                    </Link>
                  );
                })}
              </div>
            </div>
            <LiveElectionCard />
          </div>
        </section>
      )}

      {!hasActivityContent && (
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
