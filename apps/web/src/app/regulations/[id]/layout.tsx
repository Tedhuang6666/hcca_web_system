import type { Metadata } from "next";
import type { ReactNode } from "react";

import { serverApiUrl } from "@/lib/config";

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
  const title = reg?.title ?? decodeURIComponent(id);
  const description = reg?.preface?.slice(0, 120) || "校園自治平台法規條文查詢。";
  const path = `/regulations/${encodeURIComponent(title)}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      type: "article",
      url: path,
      siteName: "HCCA 校園自治整合平台",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default function RegulationDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
