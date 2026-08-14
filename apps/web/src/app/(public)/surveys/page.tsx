import SurveysClient from "./client";
import { fetchPublicSurveys } from "@/lib/serverFetch";

export default async function SurveysPage() {
  const initialSurveys = await fetchPublicSurveys("open");
  return <SurveysClient initialSurveys={initialSurveys} />;
}
