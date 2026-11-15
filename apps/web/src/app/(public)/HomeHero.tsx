import { headers } from "next/headers";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import ActivityImage from "@/components/gallery/ActivityImage";
import { BRANDING } from "@/lib/branding";
import { galleryDate, readActivityAlbums } from "@/lib/public-activity-albums";
import { sanitizeCustomCss } from "@/lib/sanitize";
import type { PublicSiteBundleOut } from "@/lib/types";
import HomeHeroScene from "./HomeHeroScene";

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
    : "學生自治 / 校園活動 / 公開資訊";
  const activity = readActivityAlbums(settings ? settings.homepage_blocks : null).find((album) => album.photos.length > 0);
  const photos = activity ? [...activity.photos.filter((photo) => photo.featured), ...activity.photos.filter((photo) => !photo.featured)] : [];
  // The built-in album opens on the closer action shot; edited albums retain their order.
  if (settings && settings.homepage_blocks?.activity_gallery === undefined) {
    const actionIndex = photos.findIndex((photo) => photo.src === "/images/activities/welcome/team-games.webp");
    if (actionIndex > 0) photos.unshift(...photos.splice(actionIndex, 1));
  }

  return (
    <>
      {settings?.custom_css && (
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: sanitizeCustomCss(settings.custom_css) }} />
      )}
      <section className="public-home-hero" aria-labelledby="campus-title">
        <HomeHeroScene>
          <div className="campus-edition" aria-hidden="true">{BRANDING.acronym}</div>
          <div className="campus-masthead-copy">
            <h1 id="campus-title">{title === BRANDING.orgShortName
              ? <><span>新竹高中</span><span>班聯會</span></>
              : title}</h1>
            {subtitle && <p>{subtitle === "學生自治 / 校園活動 / 公開資訊"
              ? <><span>學生自治</span><span>校園活動</span><span>公開資訊</span></>
              : subtitle}</p>}
          </div>
            {activity && photos.length > 0 && (
              <Link href={"/gallery/" + activity.id} className="campus-hero-activity" aria-label={activity.title + "活動紀錄與攝影集"}>
                <span className="campus-hero-photo">
                  <ActivityImage photos={photos} sizes="100vw" preload />
                </span>
                <span className="campus-hero-activity-caption">
                  <span className="campus-event-meta">{activity.date && <time dateTime={activity.date}>{galleryDate(activity.date)}</time>}</span>
                  <strong className="campus-event-title">{activity.title}</strong>
                  <span className="campus-event-link">活動紀錄 / 攝影集<ArrowRight size={20} aria-hidden /></span>
                </span>
              </Link>
            )}
        </HomeHeroScene>
      </section>
    </>
  );
}
