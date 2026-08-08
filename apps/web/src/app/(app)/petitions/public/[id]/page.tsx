import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BRANDING } from "@/lib/branding";
import { fetchPublicPetition } from "@/lib/publicSeoFetch";
import { absoluteUrl, excerpt, JsonLd, pageMetadata } from "@/lib/seo";

type PublicPetitionPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PublicPetitionPageProps): Promise<Metadata> {
  const { id } = await params;
  const item = await fetchPublicPetition(id);
  if (!item) {
    return pageMetadata({
      title: "公開陳情",
      description: "閱讀經同意公開的校園問題與處理回覆。",
      path: `/petitions/public/${encodeURIComponent(id)}`,
    });
  }

  return pageMetadata({
    title: item.title,
    description: excerpt(item.content, "閱讀這件經同意公開的校園陳情與處理回覆。", 160),
    path: `/petitions/public/${item.id}`,
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
          publisher: {
            "@type": "Organization",
            name: BRANDING.orgName,
          },
        }}
      />
      <article className="max-w-3xl mx-auto space-y-6">
        <Link href="/petitions/public" className="text-sm" style={{ color: "var(--text-muted)" }}>
          ← 返回公開陳情
        </Link>
        <header>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            #{item.case_number} · {item.current_org_name} · {item.type_name}
          </p>
          <h1 className="text-2xl font-semibold mt-2" style={{ color: "var(--text-primary)" }}>
            {item.title}
          </h1>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
            公開於 {new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" }).format(new Date(item.published_at))}
          </p>
        </header>
        <section className="card p-5 space-y-4">
          <h2 className="font-semibold">陳情內容</h2>
          <p className="whitespace-pre-wrap text-sm leading-7" style={{ color: "var(--text-primary)" }}>
            {item.content}
          </p>
        </section>
        <section
          className="card p-5 space-y-4"
          style={{ background: "var(--success-dim)", borderColor: "var(--success-border)" }}
        >
          <h2 className="font-semibold" style={{ color: "var(--success)" }}>
            承辦回覆
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-7">
            {item.reply || "本案已結案，暫無公開回覆。"}
          </p>
        </section>
      </article>
    </>
  );
}
