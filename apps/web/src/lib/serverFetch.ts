import { unstable_cache } from "next/cache";

import type {
  AnnouncementListItem,
  AnnouncementOut,
  DocumentListItem,
  PublicOfficerOut,
  PublicSiteBundleOut,
  PublicSitePageOut,
  PartnerRankingItem,
  PartnerTagOut,
  RegulationListItem,
  SurveyOut,
  SurveyListItem,
} from "./types";
import type { PartnerBusinessDirectoryItem } from "./api/partner-map";
import type { UnifiedMapItem } from "./partner-map-types";
import type { ModuleStatusPublic } from "./api/system";
import { serverApiUrl } from "./config";

export const PUBLIC_REVALIDATE_SECONDS = 60;
const PUBLIC_FETCH_TIMEOUT_MS = 2_000;

async function fetchPublicApi(input: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PUBLIC_FETCH_TIMEOUT_MS);

  try {
    return await fetch(input, { cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// Root layouts are dynamic because the CSP nonce is generated per request. Keep
// public API data cacheable independently so dynamic HTML does not force a cold
// backend request on every page view.
const fetchCachedPublicJson = unstable_cache(
  async (path: string): Promise<unknown> => {
    const response = await fetchPublicApi(serverApiUrl(path));
    if (!response.ok) throw new Error(`Public API request failed: ${response.status}`);
    return response.json();
  },
  ["hcca-public-api-v1"],
  { revalidate: PUBLIC_REVALIDATE_SECONDS },
);
const fetchCachedLivePublicJson = unstable_cache(
  async (path: string): Promise<unknown> => {
    const response = await fetchPublicApi(serverApiUrl(path));
    if (!response.ok) throw new Error(`Public API request failed: ${response.status}`);
    return response.json();
  },
  ["hcca-public-live-api-v1"],
  { revalidate: 15 },
);

async function getCachedPublicJson<T>(path: string, live = false): Promise<T | null> {
  try {
    const fetcher = live ? fetchCachedLivePublicJson : fetchCachedPublicJson;
    return (await fetcher(path)) as T;
  } catch {
    return null;
  }
}

export function fetchPublicJson<T>(
  path: string,
  options: { revalidate?: number } = {},
): Promise<T | null> {
  return getCachedPublicJson<T>(path, options.revalidate === 15);
}

export async function fetchPublicBundle(): Promise<PublicSiteBundleOut | null> {
  return getCachedPublicJson<PublicSiteBundleOut>("/site/public");
}

export async function fetchAnnouncements(limit = 100): Promise<AnnouncementListItem[]> {
  return (await getCachedPublicJson<AnnouncementListItem[]>(`/announcements?limit=${limit}`)) ?? [];
}

export async function fetchPublicDocuments(
  params: { limit?: number; offset?: number } = {},
): Promise<DocumentListItem[] | null> {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));

  return getCachedPublicJson<DocumentListItem[]>(`/documents?${search.toString()}`);
}

export async function fetchPublicRegulations(): Promise<RegulationListItem[]> {
  return (await getCachedPublicJson<RegulationListItem[]>("/regulations")) ?? [];
}

export async function fetchPublicSurveys(status?: string): Promise<SurveyListItem[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";

  return (await getCachedPublicJson<SurveyListItem[]>(`/surveys/public${query}`)) ?? [];
}

export async function fetchPublicSurvey(id: string): Promise<SurveyOut | null> {
  return getCachedPublicJson<SurveyOut>(`/surveys/public/${encodeURIComponent(id)}`);
}

export async function fetchPublicPartnerMapData(): Promise<{
  initialItems: UnifiedMapItem[];
  initialContactBusinesses: PartnerBusinessDirectoryItem[];
  initialTags: PartnerTagOut[];
  initialRankings: PartnerRankingItem[];
}> {
  const fetchJson = async <T>(path: string): Promise<T> => {
    return (await getCachedPublicJson<T>(path)) ?? ([] as T);
  };

  const [initialItems, initialContactBusinesses, initialTags, initialRankings] = await Promise.all([
    fetchJson<UnifiedMapItem[]>("/partner-map?limit=300"),
    fetchJson<PartnerBusinessDirectoryItem[]>("/partner-map/directory"),
    fetchJson<PartnerTagOut[]>("/partner-map/tags"),
    fetchJson<PartnerRankingItem[]>("/partner-map/rankings?limit=5"),
  ]);

  return { initialItems, initialContactBusinesses, initialTags, initialRankings };
}

export async function fetchActiveUrgentAnnouncement(): Promise<AnnouncementOut | null> {
  return getCachedPublicJson<AnnouncementOut | null>("/announcements/active-urgent");
}

export async function fetchPublicModuleStatuses(): Promise<ModuleStatusPublic[]> {
  return (await getCachedPublicJson<ModuleStatusPublic[]>("/system/module-status")) ?? [];
}

export async function fetchPublicOfficers(): Promise<PublicOfficerOut[]> {
  return (await getCachedPublicJson<PublicOfficerOut[]>("/site/officers?active_only=true")) ?? [];
}

export async function fetchPublicPage(slug: string): Promise<PublicSitePageOut | null> {
  return getCachedPublicJson<PublicSitePageOut>(`/site/pages/${encodeURIComponent(slug)}`);
}

export async function fetchAnnouncement(id: string): Promise<import("./types").AnnouncementOut | null> {
  return getCachedPublicJson<import("./types").AnnouncementOut>(
    `/announcements/${encodeURIComponent(id)}`,
  );
}
