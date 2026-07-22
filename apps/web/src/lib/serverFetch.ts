import type {
  AnnouncementListItem,
  AnnouncementOut,
  PublicOfficerOut,
  PublicSiteBundleOut,
  PublicSitePageOut,
} from "./types";
import { cookies } from "next/headers";

import { serverApiUrl } from "./config";

const REVALIDATE = 30;

async function announcementFetchOptions(): Promise<RequestInit & { next?: { revalidate: number } }> {
  const cookie = (await cookies()).toString();
  return cookie
    ? { headers: { Cookie: cookie }, cache: "no-store" }
    : { next: { revalidate: REVALIDATE } };
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
      ...(await announcementFetchOptions()),
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
      ...(await announcementFetchOptions()),
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
      ...(await announcementFetchOptions()),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
