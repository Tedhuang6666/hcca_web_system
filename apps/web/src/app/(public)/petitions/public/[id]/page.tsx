import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BRANDING } from "@/lib/branding";
import { fetchPublicPetition } from "@/lib/publicSeoFetch";
import { contentOgImagePath } from "@/lib/social-metadata";
import { breadcrumbJsonLd, organizationJsonLd } from "@/lib/structured-data";
import { absoluteUrl, excerpt, JsonLd, pageMetadata } from "@/lib/seo";

type PublicPetitionPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PublicPetitionPageProps): Promise<Metadata> {
  const { id } = await params;
  const item = await fetchPublicPetition(id);
  if (!item) {
    const path = `/petitions/public/${encodeURIComponent(id)}`;
    return pageMetadata({
      title: "公開陳情",
      description: "閱讀經同意公開的校園問題與處理回覆。",
      path,
      imagePath: contentOgImagePath(path),
    });
  }

  const path = `/petitions/public/${item.id}`;
  return pageMetadata({
    title: item.title,
    description: excerpt(item.content, "閱讀這件經同意公開的校園陳情與處理回覆。", 160),
    path,
    imagePath: contentOgImagePath(path),
  });
}

export default async function PublicPetitionDetailPage({ params }: PublicPetitionPageProps) {
  const { id } = await params;
  const item = await fetchPublicPetition(id);
  if (!item) notFound();

  const canonical = absoluteUrl(`/petitions/public/${item.id}`);
  const description = excerpt(item.content, "經同意公開的校園陳情與處理回覆。", 160);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          "@id": canonical,
          headline: item.title,
          description,
          articleSection: item.type_name,
          datePublished: item.published_at,
          dateModified: item.published_at,
          inLanguage: "zh-TW",
          mainEntityOfPage: canonical,
          author: { "@type": "Organization", name: BRANDING.orgShortName },
          publisher: organizationJsonLd(),
          image: absoluteUrl(contentOgImagePath(`/petitions/public/${item.id}`)),
        }}
      />
      <JsonLd data={breadcrumbJsonLd([
        { name: "首頁", url: absoluteUrl("/") },
        { name: "公開陳情", url: absoluteUrl("/petitions/public") },
        { name: item.title, url: canonical },
      ])} />
      <article className="max-w-3xl mx-auto space-y-8">
        <header>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            #{item.case_number} · {item.current_org_name} · {item.type_name}
          </p>
          <h1 className="text-2xl font-semibold mt-2" style={{ color: "var(--text-primary)" }}>
            {item.title}
          </h1>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            公開於 {new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeZone: "Asia/Taipei" }).format(new Date(item.published_at))}
          </p>
        </header>
        <section className="space-y-3 border-t pt-6" style={{ borderColor: "var(--border)" }}>
          <h2 className="font-semibold">陳情內容</h2>
          <p className="whitespace-pre-wrap text-base leading-8" style={{ color: "var(--text-primary)" }}>
            {item.content}
          </p>
        </section>
        <section className="space-y-3 border-t pt-6" style={{ borderColor: "var(--border)" }}>
          <h2 className="font-semibold">承辦回覆</h2>
          <p className="whitespace-pre-wrap text-base leading-8" style={{ color: "var(--text-primary)" }}>
            {item.reply || "本案已結案，暫無公開回覆。"}
          </p>
        </section>
      </article>
    </>
  );
}
