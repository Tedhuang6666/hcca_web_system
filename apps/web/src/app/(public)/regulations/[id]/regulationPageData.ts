import { decodeRouteSegment } from "@/lib/regulationLawRefs";
import { fetchPublicJson, fetchPublicRegulations } from "@/lib/serverFetch";
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

export async function fetchPublicRegulation(id: string): Promise<RegulationOut | null> {
  const identifier = decodeRouteSegment(id);
  const direct = await fetchPublicJson<RegulationOut>(
    `/regulations/${encodeURIComponent(identifier)}`,
    { revalidate: 15 },
  );
  if (direct) return direct;

  // Title URL 在多個 API instance 或部署切換期間可能暫時查不到；
  // 先從公開列表解析穩定 UUID，再重試詳情，避免頁面停在 loading fallback。
  const match = (await fetchPublicRegulations()).find(
    (regulation) => regulation.title.trim() === identifier.trim(),
  );
  if (!match) return null;

  return fetchPublicJson<RegulationOut>(
    `/regulations/${encodeURIComponent(match.id)}`,
    { revalidate: 15 },
  );
}

export const fetchRegulationMeta = fetchPublicRegulation;
