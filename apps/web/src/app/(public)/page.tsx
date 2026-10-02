import "./public-home.css";
import type { Metadata } from "next";
import { preload } from "react-dom";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import {
  fetchAnnouncements,
  fetchPublicJson,
  fetchPublicShellData,
  fetchPublicSurveys,
} from "@/lib/serverFetch";
import type { CatalogCategoryOut } from "@/lib/types";
import HomeContent from "./HomeContent";
import HomeHero from "./HomeHero";

const DEFAULT_HERO_IMAGE_URL = "/brand/hcca-emblem-320.avif";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function PublicHomePage() {
  const [{ bundle, urgentAnnouncement }, openSurveys, announcements, catalog] = await Promise.all([
    fetchPublicShellData(),
    fetchPublicSurveys("open"),
    fetchAnnouncements(6),
    fetchPublicJson<CatalogCategoryOut[]>("/shop/catalog", { revalidate: 15 }),
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
      <HomeContent
        bundle={bundle}
        announcements={announcements}
        urgentAnnouncement={urgentAnnouncement}
        openSurveys={openSurveys}
        catalog={catalog}
      />
    </PublicSiteShell>
  );
}
