import { decodeRouteSegment } from "@/lib/regulationLawRefs";
import {
  fetchPublicJson,
  fetchPublicJsonResult,
  fetchPublicRegulations,
  type PublicFetchResult,
} from "@/lib/serverFetch";
import type { RegulationOut } from "@/lib/types";

export type RegulationDetailSearchParams = Record<string, string | string[] | undefined>;
export type RegulationDetailMeta = { title: string };

export function firstSearchParam(
  params: RegulationDetailSearchParams,
  key: string,
): string | null {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function fetchPublicRegulationResult(
  id: string,
): Promise<PublicFetchResult<RegulationOut>> {
  const identifier = decodeRouteSegment(id);
  const directPath = `/regulations/${encodeURIComponent(identifier)}`;
  const cachedDirect = await fetchPublicJson<RegulationOut>(directPath, { revalidate: 15 });
  if (cachedDirect) return { data: cachedDirect, status: 200 };

  const direct = await fetchPublicJsonResult<RegulationOut>(directPath);
  if (direct.data || direct.status !== 404) return direct;

  // Title URL 在多個 API instance 或部署切換期間可能暫時查不到；
  // 先從公開列表解析穩定 UUID，再重試詳情，避免頁面停在 loading fallback。
  const cachedMatch = (await fetchPublicRegulations()).find(
    (regulation) => regulation.title.trim() === identifier.trim(),
  );
  if (cachedMatch) {
    const cachedDetail = await fetchPublicJson<RegulationOut>(
      `/regulations/${encodeURIComponent(cachedMatch.id)}`,
      { revalidate: 15 },
    );
    if (cachedDetail) return { data: cachedDetail, status: 200 };
    return fetchPublicJsonResult<RegulationOut>(
      `/regulations/${encodeURIComponent(cachedMatch.id)}`,
    );
  }

  // fetchPublicRegulations() returns [] on errors for list-page resilience.
  // Confirm with an uncached read before treating a missing title as a 404.
  const list = await fetchPublicJsonResult<{ id: string; title: string }[]>("/regulations");
  if (!list.data) return { data: null, status: list.status };
  const match = list.data.find((regulation) => regulation.title.trim() === identifier.trim());
  if (!match) return { data: null, status: 404 };
  return fetchPublicJsonResult<RegulationOut>(
    `/regulations/${encodeURIComponent(match.id)}`,
  );
}

export async function fetchPublicRegulation(id: string): Promise<RegulationOut | null> {
  return (await fetchPublicRegulationResult(id)).data;
}

export const fetchRegulationMeta = fetchPublicRegulationResult;
