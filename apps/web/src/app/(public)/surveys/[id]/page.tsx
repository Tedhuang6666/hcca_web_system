import SurveyDetailClient from "./client";
import { fetchPublicSurvey } from "@/lib/serverFetch";

export default async function SurveyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initialSurvey = await fetchPublicSurvey(id);
  return <SurveyDetailClient initialSurvey={initialSurvey} />;
}
