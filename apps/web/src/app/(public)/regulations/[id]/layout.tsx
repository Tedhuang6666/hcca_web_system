import type { Metadata } from "next";
import type { ReactNode } from "react";

import { BRANDING } from "@/lib/branding";
import { contentCategoryLabel, REGULATION_CATEGORY_LABELS } from "@/lib/content-labels";
import { socialDescription } from "@/lib/social-metadata";
import { contentOgImagePath } from "@/lib/social-metadata";
import { breadcrumbJsonLd, organizationJsonLd } from "@/lib/structured-data";
import { absoluteUrl, excerpt, JsonLd, pageMetadata } from "@/lib/seo";
import { fetchPublicJson } from "@/lib/serverFetch";

type RegulationMeta = {
  title: string;
  preface: string | null;
  content: string;
  category: string;
  published_at: string | null;
  effective_date: string | null;
  is_repealed: boolean;
  version: number;
  updated_at: string;
};

async function fetchReg(id: string): Promise<RegulationMeta | null> {
  return fetchPublicJson<RegulationMeta>(
    `/regulations/${encodeURIComponent(id)}`,
    { revalidate: 15 },
  );
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const reg = await fetchReg(id);
  const regTitle = reg?.title ?? decodeURIComponent(id);
  const description = socialDescription(
    "法規",
    reg ? `${reg.title}${reg.preface ? `｜${reg.preface.slice(0, 80)}` : ""}` : regTitle,
    "法規條文查詢。",
  );
  const path = `/regulations/${encodeURIComponent(regTitle)}`;
  return pageMetadata({
    title: regTitle,
    description,
    path,
    imagePath: contentOgImagePath(path),
  });
}

export default async function RegulationDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const reg = await fetchReg(id);
  const title = reg?.title ?? decodeURIComponent(id);
  const path = "/regulations/" + encodeURIComponent(title);
  const canonical = absoluteUrl(path);
  const category = contentCategoryLabel(reg?.category, REGULATION_CATEGORY_LABELS, "法規");
  const description = excerpt(reg?.preface || reg?.content, "法規條文查詢。", 160);

  return (
    <>
      {reg && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "Legislation",
            "@id": canonical,
            name: title,
            headline: title,
            description,
            legislationType: category,
            legislationLegalForce: reg.is_repealed ? "NotInForce" : "InForce",
            legislationJurisdiction: { "@type": "AdministrativeArea", name: BRANDING.schoolName },
            legislationResponsible: organizationJsonLd(),
            legislationPassedBy: organizationJsonLd(),
            legislationDate: reg.effective_date ?? reg.published_at ?? reg.updated_at,
            dateModified: reg.updated_at,
            version: reg.version,
            inLanguage: "zh-TW",
            mainEntityOfPage: canonical,
            publisher: organizationJsonLd(),
            image: absoluteUrl(contentOgImagePath(path)),
          }}
        />
      )}
      <JsonLd data={breadcrumbJsonLd([
        { name: "首頁", url: absoluteUrl("/") },
        { name: "法規查詢", url: absoluteUrl("/regulations") },
        { name: title, url: canonical },
      ])} />
      {children}
    </>
  );
}
