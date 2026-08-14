import { serverApiUrl } from "@/lib/config";
import { decodeRouteSegment } from "@/lib/regulationLawRefs";

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
  try {
    const response = await fetch(
      serverApiUrl(`/regulations/${encodeURIComponent(decodeRouteSegment(id))}`),
      { next: { revalidate: 60 } },
    );
    if (!response.ok) return null;
    const data = await response.json() as { title?: unknown };
    return typeof data.title === "string" ? { title: data.title } : null;
  } catch {
    return null;
  }
}
