import { fetchActiveUrgentAnnouncement, fetchAnnouncements } from "@/lib/serverFetch";
import type { PublicSiteBundleOut } from "@/lib/types";
import HomeContent from "./HomeContent";

export default async function DeferredHomeContent({
  bundle,
}: {
  bundle: PublicSiteBundleOut | null;
}) {
  const [announcements, urgentAnnouncement] = await Promise.all([
    fetchAnnouncements(6),
    fetchActiveUrgentAnnouncement(),
  ]);

  return (
    <HomeContent
      bundle={bundle}
      announcements={announcements}
      urgentAnnouncement={urgentAnnouncement}
    />
  );
}
