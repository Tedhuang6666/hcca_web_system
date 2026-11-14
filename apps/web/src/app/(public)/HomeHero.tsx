import { headers } from "next/headers";
import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";

import PublicEmblem from "@/components/site/PublicEmblem";
import { BRANDING } from "@/lib/branding";
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
  const title = configuredTitle && configuredTitle !== BRANDING.orgShortName && configuredTitle !== BRANDING.orgName
    ? configuredTitle
    : BRANDING.platformName;
  const configuredSubtitle = settings?.hero_subtitle?.trim();
  const subtitle = configuredSubtitle && !LEGACY_SUBTITLES.has(configuredSubtitle)
    ? configuredSubtitle
    : null;

  return (
    <>
      {settings?.custom_css && (
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: sanitizeCustomCss(settings.custom_css) }} />
      )}
      <section className="public-hero public-home-hero" aria-labelledby="campus-title">
        <div className="campus-masthead">
          <div className="campus-masthead-copy">
            <h1 id="campus-title">{title === BRANDING.platformName ? <>
              <span>{BRANDING.orgShortName}</span><span className="campus-title-system">{BRANDING.platformName.slice(BRANDING.orgShortName.length)}</span>
            </> : title}</h1>
            {subtitle && <p>{subtitle}</p>}
            <div className="campus-masthead-actions">
              <Link href="#campus-news-title" className="public-cta-primary">
                最新消息 <ArrowDown size={17} aria-hidden />
              </Link>
              <Link href="/petitions/public" className="public-cta-secondary">
                公開陳情 <ArrowRight size={17} aria-hidden />
              </Link>
            </div>
          </div>
          <div className="campus-masthead-emblem" aria-hidden="true">
            <PublicEmblem
              src={settings?.site_logo_url?.trim() || BRANDING.publicEmblemUrl}
              alt=""
              sizes="(max-width: 639px) 80px, 144px"
              priority
            />
          </div>
        </div>
      </section>
    </>
  );
}
