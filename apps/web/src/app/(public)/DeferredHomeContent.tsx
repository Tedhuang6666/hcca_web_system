import { fetchAnnouncements } from "@/lib/serverFetch";
import type { AnnouncementOut, PublicSiteBundleOut } from "@/lib/types";
import HomeContent from "./HomeContent";

export default async function DeferredHomeContent({
  bundle,
  urgentAnnouncement,
}: {
  bundle: PublicSiteBundleOut | null;
  urgentAnnouncement: AnnouncementOut | null;
}) {
  const announcements = await fetchAnnouncements(6);

  return (
    <HomeContent
      bundle={bundle}
      announcements={announcements}
      urgentAnnouncement={urgentAnnouncement}
    />
  );
}
