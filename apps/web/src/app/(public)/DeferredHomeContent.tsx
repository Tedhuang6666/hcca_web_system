import {
  fetchAnnouncements,
  fetchPublicJson,
  fetchPublicModuleStatuses,
} from "@/lib/serverFetch";
import type {
  AnnouncementOut,
  CatalogCategoryOut,
  PublicSiteBundleOut,
  SurveyListItem,
} from "@/lib/types";
import HomeContent from "./HomeContent";

export default async function DeferredHomeContent({
  bundle,
  urgentAnnouncement,
  openSurveys,
}: {
  bundle: PublicSiteBundleOut | null;
  urgentAnnouncement: AnnouncementOut | null;
  openSurveys: SurveyListItem[];
}) {
  const [announcements, catalog, moduleStatuses] = await Promise.all([
    fetchAnnouncements(6),
    fetchPublicJson<CatalogCategoryOut[]>("/shop/catalog", { revalidate: 15 }),
    fetchPublicModuleStatuses(),
  ]);
  const shopUnavailable = moduleStatuses.some((module) => module.id === "shop" && module.on);

  return (
    <HomeContent
      bundle={bundle}
      announcements={announcements}
      urgentAnnouncement={urgentAnnouncement}
      openSurveys={openSurveys}
      catalog={catalog}
      shopUnavailable={shopUnavailable}
    />
  );
}
