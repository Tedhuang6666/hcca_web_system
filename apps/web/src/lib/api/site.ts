import type {
  PublicLinkCategoryCreate, PublicLinkCategoryOut, PublicLinkCategoryUpdate, PublicLinkCreate, PublicLinkOut, PublicLinkUpdate, PublicOfficerCandidateOut, PublicOfficerOut, PublicOfficerProfileCreate, PublicOfficerProfileOut, PublicOfficerProfileUpdate, PublicSiteBundleOut, PublicSitePageCreate, PublicSitePageOut, PublicSitePageUpdate, PublicSiteSettingsOut, PublicSiteSettingsUpdate, UploadedImageOut,
} from "../types";
import { BASE, get, post, patch, del, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError } from "./core";

// ── 公開官網 / Linktree ──────────────────────────────────────────────────────

export const siteApi = {
  public: () => get<PublicSiteBundleOut>("/site/public"),
  publicLinks: () => get<PublicLinkOut[]>("/site/links"),
  publicLinkCategories: () => get<PublicLinkCategoryOut[]>("/site/link-categories"),
  publicOfficers: (active_only = true) =>
    get<PublicOfficerOut[]>(`/site/officers?active_only=${active_only}`),
  publicPages: () => get<PublicSitePageOut[]>("/site/pages"),
  publicPage: (slug: string) => get<PublicSitePageOut>(`/site/pages/${encodeURIComponent(slug)}`),

  adminSettings: () => get<PublicSiteSettingsOut>("/site/admin/settings"),
  updateSettings: (body: PublicSiteSettingsUpdate) =>
    patch<PublicSiteSettingsOut>("/site/admin/settings", body),

  uploadImage: async (file: File): Promise<UploadedImageOut> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/site/admin/images`, {
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

  adminLinkCategories: () => get<PublicLinkCategoryOut[]>("/site/admin/link-categories"),
  createLinkCategory: (body: PublicLinkCategoryCreate) =>
    post<PublicLinkCategoryOut>("/site/admin/link-categories", body),
  updateLinkCategory: (id: string, body: PublicLinkCategoryUpdate) =>
    patch<PublicLinkCategoryOut>(`/site/admin/link-categories/${encodeURIComponent(id)}`, body),
  deleteLinkCategory: (id: string) =>
    del<void>(`/site/admin/link-categories/${encodeURIComponent(id)}`),

  adminLinks: () => get<PublicLinkOut[]>("/site/admin/links"),
  createLink: (body: PublicLinkCreate) => post<PublicLinkOut>("/site/admin/links", body),
  updateLink: (id: string, body: PublicLinkUpdate) =>
    patch<PublicLinkOut>(`/site/admin/links/${encodeURIComponent(id)}`, body),
  deleteLink: (id: string) => del<void>(`/site/admin/links/${encodeURIComponent(id)}`),

  officerCandidates: (active_only = true) =>
    get<PublicOfficerCandidateOut[]>(`/site/admin/officer-candidates?active_only=${active_only}`),
  officerProfiles: () => get<PublicOfficerProfileOut[]>("/site/admin/officer-profiles"),
  createOfficerProfile: (body: PublicOfficerProfileCreate) =>
    post<PublicOfficerProfileOut>("/site/admin/officer-profiles", body),
  updateOfficerProfile: (id: string, body: PublicOfficerProfileUpdate) =>
    patch<PublicOfficerProfileOut>(`/site/admin/officer-profiles/${encodeURIComponent(id)}`, body),
  deleteOfficerProfile: (id: string) =>
    del<void>(`/site/admin/officer-profiles/${encodeURIComponent(id)}`),

  adminPages: () => get<PublicSitePageOut[]>("/site/admin/pages"),
  createPage: (body: PublicSitePageCreate) => post<PublicSitePageOut>("/site/admin/pages", body),
  updatePage: (id: string, body: PublicSitePageUpdate) =>
    patch<PublicSitePageOut>(`/site/admin/pages/${encodeURIComponent(id)}`, body),
  deletePage: (id: string) => del<void>(`/site/admin/pages/${encodeURIComponent(id)}`),
};
