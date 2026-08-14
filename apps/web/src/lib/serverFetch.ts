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

const REVALIDATE = 30;

function announcementFetchOptions(): RequestInit & { next?: { revalidate: number } } {
  // Public pages must not forward a visitor's session cookie into a cacheable
  // response. Authenticated announcement management uses the client API layer.
  return { next: { revalidate: REVALIDATE } };
}

export async function fetchPublicBundle(): Promise<PublicSiteBundleOut | null> {
  try {
    const res = await fetch(serverApiUrl("/site/public"), { next: { revalidate: REVALIDATE } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchAnnouncements(limit = 100): Promise<AnnouncementListItem[]> {
  try {
    const res = await fetch(serverApiUrl(`/announcements?limit=${limit}`), {
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
    const res = await fetch(serverApiUrl(`/documents?${search.toString()}`), {
      next: { revalidate: REVALIDATE },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchPublicRegulations(): Promise<RegulationListItem[]> {
  try {
    const res = await fetch(serverApiUrl("/regulations"), {
      next: { revalidate: REVALIDATE },
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
    const res = await fetch(serverApiUrl(`/surveys/public${query}`), {
      next: { revalidate: REVALIDATE },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchPublicSurvey(id: string): Promise<SurveyOut | null> {
  try {
    const res = await fetch(
      serverApiUrl(`/surveys/public/${encodeURIComponent(id)}`),
      { next: { revalidate: REVALIDATE } },
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
      const res = await fetch(serverApiUrl(path), { next: { revalidate: REVALIDATE } });
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
    const res = await fetch(serverApiUrl("/announcements/active-urgent"), {
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
    const res = await fetch(serverApiUrl("/system/module-status"), {
      next: { revalidate: REVALIDATE },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchPublicOfficers(): Promise<PublicOfficerOut[]> {
  try {
    const res = await fetch(serverApiUrl("/site/officers?active_only=true"), {
      next: { revalidate: REVALIDATE },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function fetchPublicPage(slug: string): Promise<PublicSitePageOut | null> {
  try {
    const res = await fetch(serverApiUrl(`/site/pages/${encodeURIComponent(slug)}`), {
      next: { revalidate: REVALIDATE },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchAnnouncement(id: string): Promise<import("./types").AnnouncementOut | null> {
  try {
    const res = await fetch(serverApiUrl(`/announcements/${encodeURIComponent(id)}`), {
      ...announcementFetchOptions(),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
