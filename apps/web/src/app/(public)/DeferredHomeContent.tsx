import { fetchAnnouncements } from "@/lib/serverFetch";
import type { AnnouncementOut, PublicSiteBundleOut, SurveyListItem } from "@/lib/types";
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
  const announcements = await fetchAnnouncements(6);

  return (
    <HomeContent
      bundle={bundle}
      announcements={announcements}
      urgentAnnouncement={urgentAnnouncement}
      openSurveys={openSurveys}
    />
  );
}
