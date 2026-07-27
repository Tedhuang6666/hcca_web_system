import type { Metadata } from "next";

import { serverApiUrl, uploadUrl } from "@/lib/config";
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
  const imagePath = item?.media?.[0]?.url ? uploadUrl(item.media[0].url) : undefined;

  return pageMetadata({ title, description, path, imagePath });
}

export default async function AnnouncementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await fetchAnnouncement(id);
  const path = `/announcements/${encodeURIComponent(id)}`;
  const published = item?.published_at ?? item?.created_at;

  return (
    <>
      {item && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "Article",
            headline: item.title,
            description: excerpt(markdownFromContent(item.content), "校園自治平台公告。"),
            datePublished: published,
            dateModified: item.updated_at,
            author: { "@type": "Person", name: item.author_name || "新竹高中班聯會" },
            publisher: { "@type": "Organization", name: "新竹高中班聯會" },
            mainEntityOfPage: absoluteUrl(path),
            image: item.media.map((media) => uploadUrl(media.url)).filter(Boolean),
          }}
        />
      )}
      <AnnouncementDetailPageClient initialItem={item} />
    </>
  );
}
