import { notFound } from "next/navigation";

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
  const result = await fetchRegulationMeta(id);
  if (result.status === 404) notFound();
  const initialMeta = result.data;

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
