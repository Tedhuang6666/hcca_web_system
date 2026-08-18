import "./public-home.css";
import { Suspense } from "react";
import type { Metadata } from "next";
import { preload } from "react-dom";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicShellData } from "@/lib/serverFetch";
import DeferredHomeContent from "./DeferredHomeContent";
import HomeHero from "./HomeHero";

const DEFAULT_HERO_IMAGE_URL = "/brand/hcca-emblem-320.avif";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

function DeferredHomeFallback() {
  return <div className="min-h-40" aria-hidden="true" />;
}

export default async function PublicHomePage() {
  const { bundle, urgentAnnouncement } = await fetchPublicShellData();
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
      <HomeHero bundle={bundle} />
      <Suspense fallback={<DeferredHomeFallback />}>
        <DeferredHomeContent bundle={bundle} />
      </Suspense>
    </PublicSiteShell>
  );
}
