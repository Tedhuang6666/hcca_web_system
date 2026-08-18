import type {
  AnnouncementCreate, AnnouncementListItem, AnnouncementMediaOut, AnnouncementOut, AnnouncementStatsOut, AnnouncementUpdate,
} from "../types";
import { BASE, get, post, patch, del, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError, uploadWithProgress } from "./core";

// ── 公告系統 ───────────────────────────────────────────────────────────────────

const ACTIVE_URGENT_CACHE_TTL_MS = 60_000;
let activeUrgentCache: { value: AnnouncementOut | null; expiresAt: number } | null = null;
let activeUrgentPromise: Promise<AnnouncementOut | null> | null = null;

function invalidateActiveUrgentCache(): void {
  activeUrgentCache = null;
}

function refreshActiveUrgent(): Promise<AnnouncementOut | null> {
  invalidateActiveUrgentCache();
  return getActiveUrgent();
}

function getActiveUrgent(): Promise<AnnouncementOut | null> {
  if (activeUrgentCache && activeUrgentCache.expiresAt > Date.now()) {
    return Promise.resolve(activeUrgentCache.value);
  }
  if (activeUrgentPromise) return activeUrgentPromise;

  const nextRequest = get<AnnouncementOut | null>("/announcements/active-urgent")
    .then((value) => {
      activeUrgentCache = {
        value,
        expiresAt: Date.now() + ACTIVE_URGENT_CACHE_TTL_MS,
      };
      return value;
    })
    .finally(() => {
      activeUrgentPromise = null;
    });
  activeUrgentPromise = nextRequest;
  return nextRequest;
}

export const announcementsApi = {
  activeUrgent: getActiveUrgent,
  refreshActiveUrgent,
  list: (params?: { org_id?: string; activity_id?: string; skip?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.org_id) qs.set("org_id", params.org_id);
    if (params?.activity_id) qs.set("activity_id", params.activity_id);
    if (params?.skip != null) qs.set("skip", String(params.skip));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return get<AnnouncementListItem[]>(`/announcements${q ? `?${q}` : ""}`);
  },
  listAll: (params?: { org_id?: string; activity_id?: string; skip?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.org_id) qs.set("org_id", params.org_id);
    if (params?.activity_id) qs.set("activity_id", params.activity_id);
    if (params?.skip != null) qs.set("skip", String(params.skip));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return get<AnnouncementListItem[]>(`/announcements/admin/all${q ? `?${q}` : ""}`);
  },
  get: (id: string) => get<AnnouncementOut>(`/announcements/${id}`),
  create: (body: AnnouncementCreate) => post<AnnouncementOut>("/announcements", body),
  update: async (id: string, body: AnnouncementUpdate) => {
    const result = await patch<AnnouncementOut>(`/announcements/${id}`, body);
    invalidateActiveUrgentCache();
    return result;
  },
  publish: async (id: string) => {
    const result = await post<AnnouncementOut>(`/announcements/${id}/publish`, {});
    invalidateActiveUrgentCache();
    return result;
  },
  unpublish: async (id: string) => {
    const result = await post<AnnouncementOut>(`/announcements/${id}/unpublish`, {});
    invalidateActiveUrgentCache();
    return result;
  },
  setUrgent: async (id: string, body: {
    is_urgent?: boolean;
    urgent_until?: string | null;
    show_on_every_visit?: boolean;
  }) => {
    const result = await patch<AnnouncementOut>(`/announcements/${id}/urgent`, body);
    invalidateActiveUrgentCache();
    return result;
  },
  delete: async (id: string) => {
    const result = await del<void>(`/announcements/${id}`);
    invalidateActiveUrgentCache();
    return result;
  },
  uploadMedia: async (id: string, file: File, onProgress?: (progress: number) => void): Promise<AnnouncementMediaOut> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      uploadWithProgress(`${BASE}/announcements/${id}/media`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      }, onProgress);
    let res = await doFetch();
    if (res.status === 401) {
      const ok = await silentRefresh();
      if (ok) res = await doFetch();
    }
    if (!res.ok) {
      throw new ApiError(res.status, await errorMessageFromResponse(res));
    }
    return res.json();
  },
  deleteMedia: (annId: string, mediaId: string) =>
    del<void>(`/announcements/${annId}/media/${mediaId}`),
  getStats: (id: string) => get<AnnouncementStatsOut>(`/announcements/${id}/stats`),
};
