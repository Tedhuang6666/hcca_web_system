import type {
  AnnouncementListItem,
  AnnouncementOut,
  PublicOfficerOut,
  PublicSiteBundleOut,
  PublicSitePageOut,
} from "./types";
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
