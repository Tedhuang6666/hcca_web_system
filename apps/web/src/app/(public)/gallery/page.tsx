import PublicSiteShell from "@/components/site/PublicSiteShell";
import GalleryExperience from "@/components/gallery/GalleryExperience";
import { readActivityAlbums } from "@/lib/public-activity-albums";
import { pageMetadata } from "@/lib/seo";
import { fetchPublicShellData } from "@/lib/serverFetch";

export const metadata = pageMetadata({
  title: "影像紀事・活動成果",
  description: "那些被留下的瞬間。新竹高中班聯會的活動、人物與故事。",
  path: "/gallery",
  type: "website",
});

export default async function GalleryPage({ searchParams }: {
  searchParams: Promise<{ event?: string }>;
}) {
  const [{ bundle, urgentAnnouncement }, query] = await Promise.all([fetchPublicShellData(), searchParams]);
  const albums = readActivityAlbums(bundle ? bundle.settings.homepage_blocks : null)
    .filter((album) => album.photos.length > 0 || album.keyVisual);
  return <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings} urgentAnnouncement={urgentAnnouncement}>
    <GalleryExperience albums={albums} initialEvent={query.event} unavailable={!bundle} />
  </PublicSiteShell>;
}
