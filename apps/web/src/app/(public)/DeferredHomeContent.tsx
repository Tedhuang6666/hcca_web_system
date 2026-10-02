import { fetchAnnouncements, fetchPublicJson } from "@/lib/serverFetch";
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
  const [announcements, catalog] = await Promise.all([
    fetchAnnouncements(6),
    fetchPublicJson<CatalogCategoryOut[]>("/shop/catalog", { revalidate: 15 }),
  ]);

  return (
    <HomeContent
      bundle={bundle}
      announcements={announcements}
      urgentAnnouncement={urgentAnnouncement}
      openSurveys={openSurveys}
      catalog={catalog}
    />
  );
}
