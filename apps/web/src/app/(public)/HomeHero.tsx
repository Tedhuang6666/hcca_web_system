import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { headers } from "next/headers";

import PublicEmblem from "@/components/site/PublicEmblem";
import { BRANDING } from "@/lib/branding";
import { sanitizeCustomCss } from "@/lib/sanitize";
import type { AnnouncementOut, PublicSiteBundleOut, SurveyListItem } from "@/lib/types";

const LEGACY_HERO_SUBTITLE = "連結學生、整理公共資訊，讓資訊能被更多人看見";

function formatShortDate(value: string | null): string | null {
  if (!value) return null;

  return new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric" }).format(
    new Date(value),
  );
}

export default async function HomeHero({
  bundle,
  urgentAnnouncement,
  openSurvey,
}: {
  bundle: PublicSiteBundleOut | null;
  urgentAnnouncement: AnnouncementOut | null;
  openSurvey: SurveyListItem | null;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const settings = bundle?.settings;
  const siteTitle = settings?.site_title?.trim() || "新竹高中班聯會";
  const configuredHeroTitle = settings?.hero_title?.trim();
  const heroTitle = configuredHeroTitle && configuredHeroTitle !== siteTitle
    ? configuredHeroTitle
    : "竹嶺班聯";
  const configuredHeroSubtitle = settings?.hero_subtitle?.trim();
  const heroSubtitle = configuredHeroSubtitle && configuredHeroSubtitle !== LEGACY_HERO_SUBTITLE
    ? configuredHeroSubtitle
    : "查看正在發生的事件，並表達你的意見！";
  const publicEmblemUrl = settings?.site_logo_url?.trim() || BRANDING.publicEmblemUrl;
  const surveyDeadline = formatShortDate(openSurvey?.closes_at ?? null);
  const primaryAction = urgentAnnouncement
    ? {
        href: urgentAnnouncement.link_url?.trim() || `/news/${urgentAnnouncement.id}`,
        label: "查看重要公告",
        status: "重要公告",
        title: urgentAnnouncement.title,
        detail: "請先查看這則重要公告",
      }
    : openSurvey
      ? {
          href: `/surveys/${encodeURIComponent(openSurvey.title)}`,
          label: "填寫校園調查",
          status: "正在收集意見",
          title: openSurvey.title,
          detail: surveyDeadline ? `截止 ${surveyDeadline}` : "開放填答中",
        }
      : {
          href: "/news",
          label: "查看最新公告",
          status: "最新校園動態",
          title: "公告、公開資料與校園意見都在這裡。",
          detail: "先從最新消息開始",
        };

  return (
    <>
      {settings?.custom_css && (
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: sanitizeCustomCss(settings.custom_css) }} />
      )}
      <section className="public-hero public-home-hero">
        <div className="public-hero-inner">
          <div className="public-hero-copy">
            <h1>{heroTitle}</h1>
            <p className="public-hero-subtitle">{heroSubtitle}</p>
          </div>
          <div className="public-hero-actions">
            <Link href={primaryAction.href} className="public-cta-primary">
              {primaryAction.label}
              <ArrowRight size={16} aria-hidden />
            </Link>
            <Link href="/petitions/new" className="public-cta-secondary">
              提出校園意見
            </Link>
          </div>
          <aside className="public-hero-status" aria-label="目前最重要的事項">
            <span className="public-hero-status-label">{primaryAction.status}</span>
            <p>{primaryAction.title}</p>
            <span className="public-hero-status-detail">{primaryAction.detail}</span>
            <div className="public-hero-status-brand">
              <PublicEmblem
                src={publicEmblemUrl}
                alt=""
                sizes="44px"
                priority
              />
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
