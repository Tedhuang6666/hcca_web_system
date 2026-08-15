import type { Metadata } from "next";
import type { ReactNode } from "react";

import { fetchPublicJson } from "@/lib/serverFetch";
import { socialDescription } from "@/lib/social-metadata";
import { pageMetadata } from "@/lib/seo";

type SurveyMeta = {
  title: string;
  description: string | null;
  status: string;
};

async function fetchSurvey(id: string): Promise<SurveyMeta | null> {
  return fetchPublicJson<SurveyMeta>(`/surveys/public/${encodeURIComponent(id)}`);
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
  const encodedId = encodeURIComponent(id);
  return pageMetadata({
    title: surveyTitle,
    description,
    path: `/surveys/${encodedId}`,
    imagePath: `/og/surveys/${encodedId}`,
    type: "website",
  });
}

export default function SurveyDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
