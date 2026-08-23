import "./public-home.css";
import { Suspense } from "react";
import type { Metadata } from "next";
import { preload } from "react-dom";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicShellData, fetchPublicSurveys } from "@/lib/serverFetch";
import DeferredHomeContent from "./DeferredHomeContent";
import HomeHero from "./HomeHero";

const DEFAULT_HERO_IMAGE_URL = "/brand/hcca-emblem-320.avif";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

function DeferredHomeFallback() {
  return (
    <section className="public-home-loading" aria-live="polite" aria-busy="true">
      <div className="public-home-loading-inner" role="status">
        <p>正在取得最新校園動態</p>
        <div className="public-home-loading-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </section>
  );
}

export default async function PublicHomePage() {
  const [{ bundle, urgentAnnouncement }, openSurveys] = await Promise.all([
    fetchPublicShellData(),
    fetchPublicSurveys("open"),
  ]);
  const heroImageUrl = bundle?.settings?.site_logo_url?.trim() || DEFAULT_HERO_IMAGE_URL;
  // 自訂會徽若經 Next Image 處理，priority 會產生對應的 optimized preload。
  // 只有固定品牌資產能保證手動 preload 與實際 <img> URL 完全一致，避免
  // 預載原圖後又重新下載另一個 /_next/image 變體。
  if (heroImageUrl === DEFAULT_HERO_IMAGE_URL) {
    preload(heroImageUrl, {
      as: "image",
      type: "image/avif",
      fetchPriority: "high",
    });
  }

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={bundle?.settings}
      urgentAnnouncement={urgentAnnouncement}
    >
      <HomeHero
        bundle={bundle}
        urgentAnnouncement={urgentAnnouncement}
        openSurvey={openSurveys[0] ?? null}
      />
      <Suspense fallback={<DeferredHomeFallback />}>
        <DeferredHomeContent
          bundle={bundle}
          urgentAnnouncement={urgentAnnouncement}
          openSurveys={openSurveys}
        />
      </Suspense>
    </PublicSiteShell>
  );
}
