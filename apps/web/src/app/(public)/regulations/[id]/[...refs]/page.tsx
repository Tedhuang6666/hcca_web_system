import RegulationDetailPageClient from "../RegulationDetailPageClient";
import {
  fetchRegulationMeta,
  firstSearchParam,
  type RegulationDetailSearchParams,
} from "../regulationPageData";

// 處理 /regulations/{id}/第1章/第4條… 之類的條文深度連結
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; refs: string[] }>;
  searchParams: Promise<RegulationDetailSearchParams>;
}) {
  const [{ id, refs }, query] = await Promise.all([params, searchParams]);
  const initialMeta = await fetchRegulationMeta(id);

  return (
    <RegulationDetailPageClient
      initialId={id}
      initialRefs={refs}
      initialTitle={initialMeta?.title ?? null}
      initialTab={firstSearchParam(query, "tab")}
      initialArticleRef={firstSearchParam(query, "article_ref")}
      initialUnitRef={firstSearchParam(query, "unit_ref")}
    />
  );
}
