import RegulationDetailPageClient from "./RegulationDetailPageClient";
import {
  fetchPublicRegulation,
  firstSearchParam,
  type RegulationDetailSearchParams,
} from "./regulationPageData";

// 處理 /regulations/{id}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RegulationDetailSearchParams>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const initialRegulation = await fetchPublicRegulation(id);

  return (
    <RegulationDetailPageClient
      initialId={id}
      initialTitle={initialRegulation?.title ?? null}
      initialRegulation={initialRegulation}
      initialTab={firstSearchParam(query, "tab")}
      initialArticleRef={firstSearchParam(query, "article_ref")}
      initialUnitRef={firstSearchParam(query, "unit_ref")}
    />
  );
}
