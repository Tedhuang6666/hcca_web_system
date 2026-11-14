import { headers } from "next/headers";

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
  const title = configuredTitle && configuredTitle !== BRANDING.platformName
    ? configuredTitle
    : BRANDING.orgShortName;
  const configuredSubtitle = settings?.hero_subtitle?.trim();
  const subtitle = configuredSubtitle && !LEGACY_SUBTITLES.has(configuredSubtitle)
    ? configuredSubtitle
    : "校園消息、生活紀錄與學生自治。";

  return (
    <>
      {settings?.custom_css && (
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: sanitizeCustomCss(settings.custom_css) }} />
      )}
      <section className="campus-masthead" aria-labelledby="campus-title">
        <div>
          <h1 id="campus-title">{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="campus-masthead-emblem" aria-hidden="true">
          <PublicEmblem
            src={settings?.site_logo_url?.trim() || BRANDING.publicEmblemUrl}
            alt=""
            sizes="(max-width: 639px) 64px, 112px"
            priority
          />
        </div>
      </section>
    </>
  );
}
