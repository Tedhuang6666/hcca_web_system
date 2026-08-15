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

type PublicFetchInit = RequestInit & { next?: { revalidate: number } };

async function fetchPublicApi(input: string, init: PublicFetchInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PUBLIC_FETCH_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function announcementFetchOptions(): RequestInit & { next?: { revalidate: number } } {
  // Public pages must not forward a visitor's session cookie into a cacheable
  // response. Authenticated announcement management uses the client API layer.
  return { next: { revalidate: PUBLIC_REVALIDATE_SECONDS } };
}

export async function fetchPublicBundle(): Promise<PublicSiteBundleOut | null> {
  try {
    const res = await fetchPublicApi(serverApiUrl("/site/public"), {
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchAnnouncements(limit = 100): Promise<AnnouncementListItem[]> {
  try {
    const res = await fetchPublicApi(serverApiUrl(`/announcements?limit=${limit}`), {
      ...announcementFetchOptions(),
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchPublicDocuments(
  params: { limit?: number; offset?: number } = {},
): Promise<DocumentListItem[] | null> {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));

  try {
    const res = await fetchPublicApi(serverApiUrl(`/documents?${search.toString()}`), {
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchPublicRegulations(): Promise<RegulationListItem[]> {
  try {
    const res = await fetchPublicApi(serverApiUrl("/regulations"), {
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchPublicSurveys(status?: string): Promise<SurveyListItem[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";

  try {
    const res = await fetchPublicApi(serverApiUrl(`/surveys/public${query}`), {
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchPublicSurvey(id: string): Promise<SurveyOut | null> {
  try {
    const res = await fetchPublicApi(
      serverApiUrl(`/surveys/public/${encodeURIComponent(id)}`),
      { next: { revalidate: PUBLIC_REVALIDATE_SECONDS } },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchPublicPartnerMapData(): Promise<{
  initialItems: UnifiedMapItem[];
  initialContactBusinesses: PartnerBusinessDirectoryItem[];
  initialTags: PartnerTagOut[];
  initialRankings: PartnerRankingItem[];
}> {
  const fetchJson = async <T>(path: string): Promise<T> => {
    try {
      const res = await fetchPublicApi(serverApiUrl(path), {
        next: { revalidate: PUBLIC_REVALIDATE_SECONDS },
      });
      if (!res.ok) return [] as T;
      return res.json();
    } catch {
      return [] as T;
    }
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
  try {
    const res = await fetchPublicApi(serverApiUrl("/announcements/active-urgent"), {
      ...announcementFetchOptions(),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchPublicModuleStatuses(): Promise<ModuleStatusPublic[]> {
  try {
    const res = await fetchPublicApi(serverApiUrl("/system/module-status"), {
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchPublicOfficers(): Promise<PublicOfficerOut[]> {
  try {
    const res = await fetchPublicApi(serverApiUrl("/site/officers?active_only=true"), {
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchPublicPage(slug: string): Promise<PublicSitePageOut | null> {
  try {
    const res = await fetchPublicApi(serverApiUrl(`/site/pages/${encodeURIComponent(slug)}`), {
      next: { revalidate: PUBLIC_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchAnnouncement(id: string): Promise<import("./types").AnnouncementOut | null> {
  try {
    const res = await fetchPublicApi(serverApiUrl(`/announcements/${encodeURIComponent(id)}`), {
      ...announcementFetchOptions(),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
