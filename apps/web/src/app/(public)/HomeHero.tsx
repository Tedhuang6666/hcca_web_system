import { headers } from "next/headers";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import ActivityImage from "@/components/gallery/ActivityImage";
import { BRANDING } from "@/lib/branding";
import { galleryDate, readActivityAlbums } from "@/lib/public-activity-albums";
import { sanitizeCustomCss } from "@/lib/sanitize";
import type { PublicSiteBundleOut } from "@/lib/types";

const LEGACY_SUBTITLES = new Set([
  "連結學生、整理公共資訊，讓資訊能被更多人看見",
  "查看正在發生的事件，並表達你的意見！",
  BRANDING.platformName,
]);

export default async function HomeHero({ bundle }: { bundle: PublicSiteBundleOut | null }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const settings = bundle?.settings;
  const configuredTitle = settings?.hero_title?.trim();
  const title = configuredTitle && configuredTitle !== BRANDING.platformName && configuredTitle !== BRANDING.orgName
    ? configuredTitle
    : BRANDING.orgShortName;
  const configuredSubtitle = settings?.hero_subtitle?.trim();
  const subtitle = configuredSubtitle && !LEGACY_SUBTITLES.has(configuredSubtitle)
    ? configuredSubtitle
    : "最新消息、活動紀錄與學生自治資訊。";
  const activity = readActivityAlbums(settings ? settings.homepage_blocks : null).find((album) => album.photos.length > 0);
  const photos = activity ? [...activity.photos.filter((photo) => photo.featured), ...activity.photos.filter((photo) => !photo.featured)] : [];

  return (
    <>
      {settings?.custom_css && (
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: sanitizeCustomCss(settings.custom_css) }} />
      )}
      <section className="public-home-hero" aria-labelledby="campus-title">
        <div className="campus-masthead">
          <div className="campus-masthead-copy">
            <h1 id="campus-title">{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
            {activity && photos.length > 0 && (
              <Link href={"/gallery/" + activity.id} className="campus-hero-activity" aria-label={activity.title + "活動成果"}>
                <ActivityImage photos={photos} sizes="(max-width: 1240px) 100vw, 1200px" preload />
                <span className="campus-hero-activity-caption">
                  <span className="campus-event-heading"><span className="campus-event-meta">最新活動{activity.date && <> / <time dateTime={activity.date}>{galleryDate(activity.date)}</time></>}</span><strong>{activity.title}</strong></span>
                  <span className="campus-event-link">活動紀錄<ArrowRight size={20} aria-hidden /></span>
                </span>
              </Link>
            )}
        </div>
      </section>
    </>
  );
}
