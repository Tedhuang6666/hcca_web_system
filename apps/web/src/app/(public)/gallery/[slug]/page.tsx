import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import GalleryCollections from "@/components/gallery/GalleryCollections";
import { readActivityAlbums } from "@/lib/public-activity-albums";
import { pageMetadata } from "@/lib/seo";
import { fetchPublicShellData } from "@/lib/serverFetch";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ photo?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, { bundle }] = await Promise.all([params, fetchPublicShellData()]);
  const album = readActivityAlbums(bundle ? bundle.settings.homepage_blocks : null).find((item) => item.id === slug);
  return pageMetadata({
    title: album ? album.title + "｜影像紀事" : "找不到活動",
    description: album?.summary || "新竹高中班聯會活動影像紀事。",
    path: "/gallery/" + encodeURIComponent(slug),
    type: "website",
  });
}

export default async function GalleryEventPage({ params, searchParams }: Props) {
  const [{ slug }, query, { bundle, urgentAnnouncement }] = await Promise.all([params, searchParams, fetchPublicShellData()]);
  if (!bundle) return <PublicSiteShell urgentAnnouncement={urgentAnnouncement}>
    <GalleryCollections albums={[]} detail unavailable />
  </PublicSiteShell>;
  const album = readActivityAlbums(bundle.settings.homepage_blocks).find((item) => item.id === slug);
  if (!album || (!album.photos.length && !album.keyVisual)) notFound();
  return <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings} urgentAnnouncement={urgentAnnouncement}>
    <GalleryCollections albums={[album]} detail initialPhoto={query.photo} />
  </PublicSiteShell>;
}
