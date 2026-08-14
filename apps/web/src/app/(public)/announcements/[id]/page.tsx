import type { Metadata } from "next";

import { BRANDING } from "@/lib/branding";
import { serverApiUrl } from "@/lib/config";
import { contentOgImagePath } from "@/lib/social-metadata";
import { breadcrumbJsonLd, organizationJsonLd } from "@/lib/structured-data";
import { JsonLd, absoluteUrl, excerpt, pageMetadata } from "@/lib/seo";
import type { AnnouncementOut } from "@/lib/types";

import AnnouncementDetailPageClient from "./AnnouncementDetailPageClient";

async function fetchAnnouncement(id: string): Promise<AnnouncementOut | null> {
  const res = await fetch(serverApiUrl(`/announcements/${encodeURIComponent(id)}`), {
    next: { revalidate: 60 },
  });
  if (!res.ok) return null;
  return res.json();
}

function markdownFromContent(content: Record<string, unknown> | null | undefined) {
  if (!content) return "";
  if (typeof content.markdown === "string") return content.markdown;
  if (typeof content.text === "string") return content.text;
  return "";
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const item = await fetchAnnouncement(id);
  const title = item?.title ?? "公告";
  const description = excerpt(markdownFromContent(item?.content), "校園自治平台公告。");
  const path = `/announcements/${encodeURIComponent(id)}`;

  return pageMetadata({ title, description, path, imagePath: contentOgImagePath(path) });
}

export default async function AnnouncementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await fetchAnnouncement(id);
  const path = `/announcements/${encodeURIComponent(id)}`;
  const canonical = absoluteUrl(path);
  const published = item?.published_at ?? item?.created_at;

  return (
    <>
      {item && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "NewsArticle",
            "@id": canonical,
            headline: item.title,
            description: excerpt(markdownFromContent(item.content), "校園自治平台公告。"),
            articleSection: item.is_urgent ? "重要公告" : "公告",
            datePublished: published,
            dateModified: item.updated_at,
            author: { "@type": "Person", name: item.author_name || BRANDING.orgShortName },
            publisher: organizationJsonLd(),
            mainEntityOfPage: canonical,
            image: absoluteUrl(contentOgImagePath(path)),
          }}
        />
      )}
      <JsonLd data={breadcrumbJsonLd([
        { name: "首頁", url: absoluteUrl("/") },
        { name: "公告", url: absoluteUrl("/announcements") },
        { name: item?.title ?? "公告", url: canonical },
      ])} />
      <AnnouncementDetailPageClient initialItem={item} />
    </>
  );
}
