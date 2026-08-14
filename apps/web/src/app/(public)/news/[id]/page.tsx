import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AnnouncementMarkdown from "@/components/announcements/AnnouncementMarkdown";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { BRANDING } from "@/lib/branding";
import { fetchAnnouncement, fetchPublicBundle } from "@/lib/serverFetch";
import { contentOgImagePath } from "@/lib/social-metadata";
import { breadcrumbJsonLd, organizationJsonLd } from "@/lib/structured-data";
import { JsonLd, absoluteUrl, excerpt, pageMetadata } from "@/lib/seo";

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
  const description = excerpt(markdownFromContent(item?.content), "新竹高中班聯會公開公告。");
  const path = "/news/" + encodeURIComponent(id);

  return pageMetadata({ title, description, path, imagePath: contentOgImagePath(path) });
}

export default async function PublicNewsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [bundle, item] = await Promise.all([
    fetchPublicBundle(),
    fetchAnnouncement(id),
  ]);

  if (!item) notFound();

  const path = "/news/" + encodeURIComponent(id);
  const canonical = absoluteUrl(path);
  const description = excerpt(markdownFromContent(item.content), "新竹高中班聯會公開公告。");

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "NewsArticle",
          "@id": canonical,
          headline: item.title,
          description,
          articleSection: item.is_urgent ? "重要公告" : "公告",
          datePublished: item.published_at ?? item.created_at,
          dateModified: item.updated_at,
          author: { "@type": "Person", name: item.author_name || BRANDING.orgShortName },
          publisher: organizationJsonLd(),
          mainEntityOfPage: canonical,
          image: absoluteUrl(contentOgImagePath(path)),
        }}
      />
      <JsonLd data={breadcrumbJsonLd([
        { name: "首頁", url: absoluteUrl("/") },
        { name: "最新公告", url: absoluteUrl("/news") },
        { name: item.title, url: canonical },
      ])} />
      <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <article className="space-y-5">
          <header className="public-page-head space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
              {item.is_urgent && (
                <span className="badge" style={{ color: "var(--warning)", background: "var(--warning-dim)", borderColor: "var(--warning-border)" }}>
                  重要公告
                </span>
              )}
              <time dateTime={item.published_at ?? item.created_at}>
                {new Date(item.published_at ?? item.created_at).toLocaleString("zh-TW")}
              </time>
            </div>
            <h1 className="text-3xl font-bold leading-tight">{item.title}</h1>
            <p className="text-sm text-[var(--text-muted)]">公告人：{item.author_name || "未命名"}</p>
          </header>
          <div className="card p-5 md:p-7" data-reveal style={{ "--reveal-delay": "120ms" } as React.CSSProperties}>
            <AnnouncementMarkdown content={item.content} />
            {item.link_url && (
              <a
                href={item.link_url}
                className="btn btn-primary mt-6"
                target={/^https?:\/\//.test(item.link_url) ? "_blank" : undefined}
                rel={/^https?:\/\//.test(item.link_url) ? "noreferrer" : undefined}
              >
                {item.link_label || "前往連結"}
              </a>
            )}
          </div>
        </article>
      </div>
      </PublicSiteShell>
    </>
  );
}
