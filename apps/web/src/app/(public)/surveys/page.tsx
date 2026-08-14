import SurveysClient from "./client";
import { fetchPublicSurveys } from "@/lib/serverFetch";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "公開問卷",
  description: "查看目前開放填答的校園自治問卷，分享你的意見。",
  path: "/surveys",
  type: "website",
});

export default async function SurveysPage() {
  const initialSurveys = await fetchPublicSurveys("open");
  return <SurveysClient initialSurveys={initialSurveys} />;
}
