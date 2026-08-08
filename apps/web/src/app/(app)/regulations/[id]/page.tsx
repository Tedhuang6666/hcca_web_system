import RegulationDetailPageClient from "./RegulationDetailPageClient";
import {
  fetchRegulationMeta,
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
  const initialMeta = await fetchRegulationMeta(id);

  return (
    <RegulationDetailPageClient
      initialId={id}
      initialTitle={initialMeta?.title ?? null}
      initialTab={firstSearchParam(query, "tab")}
      initialArticleRef={firstSearchParam(query, "article_ref")}
      initialUnitRef={firstSearchParam(query, "unit_ref")}
    />
  );
}
