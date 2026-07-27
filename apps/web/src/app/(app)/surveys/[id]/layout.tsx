import type { Metadata } from "next";
import type { ReactNode } from "react";

import { serverApiUrl } from "@/lib/config";
import { socialDescription } from "@/lib/social-metadata";
import { pageMetadata } from "@/lib/seo";

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
  const surveyTitle = survey?.title ?? decodeURIComponent(id);
  const description = socialDescription(
    "問卷",
    survey ? `${survey.title}${survey.description ? `｜${survey.description.slice(0, 80)}` : ""}` : surveyTitle,
    "問卷填答連結。",
  );
  const path = `/surveys/${encodeURIComponent(surveyTitle)}`;
  return pageMetadata({ title: surveyTitle, description, path, type: "website" });
}

export default function SurveyDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
