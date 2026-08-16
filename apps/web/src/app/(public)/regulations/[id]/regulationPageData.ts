import { decodeRouteSegment } from "@/lib/regulationLawRefs";
import { fetchPublicJson } from "@/lib/serverFetch";
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
  return fetchPublicJson<RegulationOut>(
    `/regulations/${encodeURIComponent(decodeRouteSegment(id))}`,
  );
}

export const fetchRegulationMeta = fetchPublicRegulation;
