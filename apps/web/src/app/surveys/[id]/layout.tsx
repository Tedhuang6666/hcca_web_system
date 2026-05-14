import type { Metadata } from "next";
import type { ReactNode } from "react";

import { serverApiUrl } from "@/lib/config";

type SurveyMeta = {
  title: string;
  description: string | null;
  status: string;
};

async function fetchSurvey(id: string): Promise<SurveyMeta | null> {
  const res = await fetch(serverApiUrl(`/surveys/public/${encodeURIComponent(id)}`), {
    next: { revalidate: 60 },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const survey = await fetchSurvey(id);
  const title = survey?.title ?? decodeURIComponent(id);
  const description = survey?.description?.slice(0, 120) || "校園自治平台問卷填答連結。";
  const path = `/surveys/${encodeURIComponent(title)}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      type: "website",
      url: path,
      siteName: "HCCA 校園自治整合平台",
    },
    twitter: { card: "summary", title, description },
  };
}

export default function SurveyDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
