import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchAnnouncements, fetchPublicBundle } from "@/lib/serverFetch";
import HomeContent from "./HomeContent";

export const dynamic = "force-dynamic";

export default async function PublicHomePage() {
  const [bundle, announcements] = await Promise.all([
    fetchPublicBundle(),
    fetchAnnouncements(4),
  ]);

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <HomeContent bundle={bundle} announcements={announcements} />
    </PublicSiteShell>
  );
}
