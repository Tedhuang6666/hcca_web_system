import type { Metadata } from "next";

import { BRANDING } from "@/lib/branding";
import { contentCategoryLabel, DOCUMENT_CATEGORY_LABELS } from "@/lib/content-labels";
import { fetchPublicDocument } from "@/lib/publicSeoFetch";
import { contentOgImagePath } from "@/lib/social-metadata";
import { breadcrumbJsonLd, organizationJsonLd } from "@/lib/structured-data";
import { absoluteUrl, excerpt, JsonLd, pageMetadata } from "@/lib/seo";

import DocumentDetailEntry from "./DocumentDetailEntry";

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const document = await fetchPublicDocument(id);
  const title = document?.title ?? "公開公文";
  const description = excerpt(
    document?.subject || document?.content,
    `${BRANDING.orgShortName}公開公文。`,
    160,
  );
  const path = `/documents/${encodeURIComponent(id)}`;

  return pageMetadata({
    title,
    description,
    path,
    imagePath: contentOgImagePath(path),
  });
}

export default async function DocumentDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await fetchPublicDocument(id);
  const path = `/documents/${encodeURIComponent(id)}`;
  const canonical = absoluteUrl(path);
  const title = document?.title ?? "公開公文";

  return (
    <>
      {document && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "DigitalDocument",
            "@id": canonical,
            name: document.title,
            headline: document.title,
            description: excerpt(document.subject || document.content, `${BRANDING.orgShortName}公開公文。`, 160),
            genre: contentCategoryLabel(document.category, DOCUMENT_CATEGORY_LABELS, "公文"),
            identifier: document.serial_number,
            dateCreated: document.created_at,
            datePublished: document.issued_at ?? document.submitted_at ?? document.created_at,
            dateModified: document.updated_at,
            inLanguage: "zh-TW",
            isAccessibleForFree: true,
            mainEntityOfPage: canonical,
            publisher: organizationJsonLd(),
            image: absoluteUrl(contentOgImagePath(path)),
          }}
        />
      )}
      <JsonLd data={breadcrumbJsonLd([
        { name: "首頁", url: absoluteUrl("/") },
        { name: "公開公文", url: absoluteUrl("/documents") },
        { name: title, url: canonical },
      ])} />
      <DocumentDetailEntry initialDoc={document} />
    </>
  );
}
