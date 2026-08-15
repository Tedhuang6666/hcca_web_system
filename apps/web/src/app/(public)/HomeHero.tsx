import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { headers } from "next/headers";

import PublicEmblem from "@/components/site/PublicEmblem";
import { BRANDING } from "@/lib/branding";
import { sanitizeCustomCss } from "@/lib/sanitize";
import type { PublicSiteBundleOut } from "@/lib/types";

export default async function HomeHero({ bundle }: { bundle: PublicSiteBundleOut | null }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const settings = bundle?.settings;
  const siteTitle = settings?.site_title?.trim() || "新竹高中班聯會";
  const heroTitle = settings?.hero_title?.trim() || siteTitle;
  const heroSubtitle = settings?.hero_subtitle?.trim()
    || (!settings ? "公開資料暫時無法取得；您仍可瀏覽最新公告與班聯會公開服務。" : "");
  const ctaHref = settings?.cta_href?.trim() || "/links";
  const ctaLabel = settings?.cta_label?.trim() || "查看連結";
  const publicEmblemUrl = settings?.site_logo_url?.trim() || BRANDING.publicEmblemUrl;
  const emblemAlt = settings?.site_logo_alt?.trim() || (siteTitle ? `${siteTitle}會徽` : "網站會徽");

  return (
    <>
      {settings?.custom_css && (
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: sanitizeCustomCss(settings.custom_css) }} />
      )}
      <section className="public-hero">
        <div className="public-hero-inner">
          <div className="public-hero-copy">
            <h1>{heroTitle}</h1>
            {heroSubtitle && <p className="public-hero-subtitle">{heroSubtitle}</p>}
          </div>
          <div className="public-signboard public-identity-panel" aria-label={`${siteTitle}識別標誌`}>
            <div className="public-signboard-emblem">
              <PublicEmblem
                src={publicEmblemUrl}
                alt={emblemAlt}
                sizes="(max-width: 767px) 240px, 322px"
                priority
              />
            </div>
          </div>
          <div className="public-hero-actions">
            <Link href={ctaHref} className="public-cta-primary">
              {ctaLabel}
              <ArrowRight size={16} aria-hidden />
            </Link>
            <Link href="/news" className="public-cta-secondary">
              最新公告
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
