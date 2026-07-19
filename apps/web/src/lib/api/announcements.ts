import type {
  AnnouncementCreate, AnnouncementListItem, AnnouncementMediaOut, AnnouncementOut, AnnouncementStatsOut, AnnouncementUpdate,
} from "../types";
import { BASE, get, post, patch, del, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError } from "./core";

// ── 公告系統 ───────────────────────────────────────────────────────────────────

export const announcementsApi = {
  activeUrgent: () => get<AnnouncementOut | null>("/announcements/active-urgent"),
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
  update: (id: string, body: AnnouncementUpdate) => patch<AnnouncementOut>(`/announcements/${id}`, body),
  publish: (id: string) => post<AnnouncementOut>(`/announcements/${id}/publish`, {}),
  unpublish: (id: string) => post<AnnouncementOut>(`/announcements/${id}/unpublish`, {}),
  setUrgent: (id: string, body: {
    is_urgent?: boolean;
    urgent_until?: string | null;
    show_on_every_visit?: boolean;
  }) =>
    patch<AnnouncementOut>(`/announcements/${id}/urgent`, body),
  delete: (id: string) => del<void>(`/announcements/${id}`),
  uploadMedia: async (id: string, file: File): Promise<AnnouncementMediaOut> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/announcements/${id}/media`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      });
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
