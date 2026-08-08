import type { Metadata } from "next";
import type { ReactNode } from "react";

import { serverApiUrl } from "@/lib/config";
import { socialDescription } from "@/lib/social-metadata";
import { absoluteUrl, JsonLd, pageMetadata } from "@/lib/seo";

type RegulationMeta = {
  title: string;
  preface: string | null;
  updated_at: string;
};

async function fetchReg(id: string): Promise<RegulationMeta | null> {
  const res = await fetch(serverApiUrl(`/regulations/${encodeURIComponent(id)}`), {
    next: { revalidate: 60 },
  });
  if (!res.ok) return null;
  return res.json();
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
  return pageMetadata({ title: regTitle, description, path });
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

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "首頁", item: absoluteUrl("/") },
            { "@type": "ListItem", position: 2, name: "法規查詢", item: absoluteUrl("/regulations") },
            { "@type": "ListItem", position: 3, name: title, item: absoluteUrl(path) },
          ],
        }}
      />
      {children}
    </>
  );
}
