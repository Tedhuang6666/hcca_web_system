import PublicSiteShell from "@/components/site/PublicSiteShell";
import {
  fetchActiveUrgentAnnouncement,
  fetchAnnouncements,
  fetchPublicBundle,
} from "@/lib/serverFetch";
import HomeContent from "./HomeContent";

export default async function PublicHomePage() {
  const [bundle, announcements, urgentAnnouncement] = await Promise.all([
    fetchPublicBundle(),
    fetchAnnouncements(6),
    fetchActiveUrgentAnnouncement(),
  ]);

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <HomeContent
        bundle={bundle}
        announcements={announcements}
        urgentAnnouncement={urgentAnnouncement}
      />
    </PublicSiteShell>
  );
}
