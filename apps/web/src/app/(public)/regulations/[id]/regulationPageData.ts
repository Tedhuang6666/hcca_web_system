import { decodeRouteSegment } from "@/lib/regulationLawRefs";
import { fetchPublicJson } from "@/lib/serverFetch";

export type RegulationDetailSearchParams = Record<string, string | string[] | undefined>;
export type RegulationDetailMeta = { title: string };

export function firstSearchParam(
  params: RegulationDetailSearchParams,
  key: string,
): string | null {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function fetchRegulationMeta(id: string): Promise<RegulationDetailMeta | null> {
  const data = await fetchPublicJson<{ title?: unknown }>(
    `/regulations/${encodeURIComponent(decodeRouteSegment(id))}`,
  );
  return typeof data?.title === "string" ? { title: data.title } : null;
}
