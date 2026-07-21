import type {
  PartnerBusinessCreate, PartnerBusinessListItem, PartnerBusinessOut, PartnerBusinessUpdate, PartnerLocationCreate, PartnerLocationOut, PartnerLocationUpdate, PartnerMapItem, PartnerOfferCreate, PartnerOfferOut, PartnerOfferUpdate, PartnerRankingItem, PartnerRatingCreate, PartnerRatingOut, PartnerSubmissionCreate, PartnerSubmissionOut, PartnerTagCreate, PartnerTagOut, PartnerTagUpdate,
} from "../types";
import { get, post, patch, del } from "./core";

export type PartnerBusinessListingType = "physical" | "online";
type PartnerBusinessContactFields = {
  listing_type: PartnerBusinessListingType;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  instagram_handle: string | null;
  line_id: string | null;
  other_contact: string | null;
};
export type PartnerBusinessDirectoryItem = PartnerBusinessListItem & PartnerBusinessContactFields;
export type PartnerLocationWithMapUrl = PartnerLocationOut & { google_maps_url: string | null };
export type PartnerLocationCreateWithMapUrl = PartnerLocationCreate & {
  google_maps_url?: string | null;
};
export type PartnerBusinessCreateWithInitialLocations = PartnerBusinessCreate & {
  initial_locations?: PartnerLocationCreateWithMapUrl[];
};
export type PartnerOfferDetail = PartnerOfferOut & {
  benefit_type: "discount" | "gift" | "bundle" | "member_price" | "other";
  benefit_value: string | null;
};
export type PartnerBusinessDetail = Omit<PartnerBusinessOut, "offers" | "locations"> &
  PartnerBusinessContactFields & {
    offers: PartnerOfferDetail[];
    locations: PartnerLocationWithMapUrl[];
  };
export type PartnerDiscoveryItem = {
  id: string;
  name: string;
  summary: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  category: string | null;
  listing_type: PartnerBusinessListingType;
  tags: PartnerTagOut[];
  location_count: number;
  active_offer_count: number;
  featured_offer_title: string | null;
  featured_offer_benefit_type: PartnerOfferDetail["benefit_type"] | null;
  featured_offer_benefit_value: string | null;
};

// ── 特約地圖 ──────────────────────────────────────────────────────────────────

export const partnerMapApi = {
  list: (params?: {
    tag_ids?: string[];
    keyword?: string;
    min_lat?: string;
    max_lat?: string;
    min_lng?: string;
    max_lng?: string;
    has_active_offer?: boolean;
    limit?: string;
    offset?: string;
  }) => {
    const p = new URLSearchParams();
    params?.tag_ids?.forEach((id) => p.append("tag_ids", id));
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (key === "tag_ids" || value === undefined || value === null || value === "") return;
      p.set(key, String(value));
    });
    return get<PartnerMapItem[]>(`/partner-map${p.size ? `?${p.toString()}` : ""}`);
  },
  tags: () => get<PartnerTagOut[]>("/partner-map/tags"),
  discover: (params?: {
    listing_type?: PartnerBusinessListingType;
    tag_ids?: string[];
    keyword?: string;
    has_active_offer?: boolean;
  }) => {
    const p = new URLSearchParams();
    params?.tag_ids?.forEach((id) => p.append("tag_ids", id));
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (key === "tag_ids" || value === undefined || value === null || value === "") return;
      p.set(key, String(value));
    });
    return get<PartnerDiscoveryItem[]>(`/partner-map/discover${p.size ? `?${p}` : ""}`);
  },
  directory: (params?: { keyword?: string; limit?: string; offset?: string }) => {
    const p = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value) p.set(key, value);
    });
    return get<PartnerBusinessDirectoryItem[]>(`/partner-map/directory${p.size ? `?${p}` : ""}`);
  },
  rankings: (limit = 10) => get<PartnerRankingItem[]>(`/partner-map/rankings?limit=${limit}`),
  getBusiness: (id: string) => get<PartnerBusinessDetail>(`/partner-map/businesses/${id}`),
  recordClick: (id: string) => post<PartnerBusinessDetail>(`/partner-map/businesses/${id}/click`, {}),
  checkIn: (id: string) => post<PartnerBusinessDetail>(`/partner-map/businesses/${id}/check-in`, {}),
  listRatings: (id: string) => get<PartnerRatingOut[]>(`/partner-map/businesses/${id}/ratings`),
  rateBusiness: (id: string, body: PartnerRatingCreate) =>
    post<PartnerRatingOut>(`/partner-map/businesses/${id}/ratings`, body),
  submitBusiness: (body: PartnerSubmissionCreate) =>
    post<PartnerSubmissionOut>("/partner-map/submissions", body),

  adminListBusinesses: (params?: { include_inactive?: boolean; limit?: string; offset?: string }) => {
    const p = new URLSearchParams();
    if (params?.include_inactive !== undefined) p.set("include_inactive", String(params.include_inactive));
    if (params?.limit) p.set("limit", params.limit);
    if (params?.offset) p.set("offset", params.offset);
    return get<PartnerBusinessDirectoryItem[]>(`/partner-map/admin/businesses${p.size ? `?${p}` : ""}`);
  },
  adminGetBusiness: (id: string) => get<PartnerBusinessDetail>(`/partner-map/admin/businesses/${id}`),
  createBusiness: (body: PartnerBusinessCreateWithInitialLocations) =>
    post<PartnerBusinessDetail>("/partner-map/admin/businesses", body),
  updateBusiness: (id: string, body: PartnerBusinessUpdate) =>
    patch<PartnerBusinessDetail>(`/partner-map/admin/businesses/${id}`, body),
  deleteBusiness: (id: string) => del<void>(`/partner-map/admin/businesses/${id}`),
  adminSubmissions: (params?: { status?: string }) => {
    const qs = params?.status ? `?${new URLSearchParams({ status: params.status }).toString()}` : "";
    return get<PartnerSubmissionOut[]>(`/partner-map/admin/submissions${qs}`);
  },
  reviewSubmission: (id: string, body: { status: string; review_note?: string | null; business_id?: string | null }) =>
    patch<PartnerSubmissionOut>(`/partner-map/admin/submissions/${id}`, body),

  adminTags: () => get<PartnerTagOut[]>("/partner-map/admin/tags"),
  createTag: (body: PartnerTagCreate) => post<PartnerTagOut>("/partner-map/admin/tags", body),
  updateTag: (id: string, body: PartnerTagUpdate) =>
    patch<PartnerTagOut>(`/partner-map/admin/tags/${id}`, body),
  deleteTag: (id: string) => del<void>(`/partner-map/admin/tags/${id}`),

  createLocation: (businessId: string, body: PartnerLocationCreateWithMapUrl) =>
    post<PartnerLocationWithMapUrl>(`/partner-map/admin/businesses/${businessId}/locations`, body),
  parseGoogleMaps: (url: string) =>
    post<{ google_maps_url: string; name: string | null; address: string | null; latitude: number; longitude: number }>(
      "/partner-map/admin/locations/parse-google-maps",
      { url },
    ),
  updateLocation: (id: string, body: PartnerLocationUpdate) =>
    patch<PartnerLocationOut>(`/partner-map/admin/locations/${id}`, body),
  deleteLocation: (id: string) => del<void>(`/partner-map/admin/locations/${id}`),

  createOffer: (businessId: string, body: PartnerOfferCreate) =>
    post<PartnerOfferOut>(`/partner-map/admin/businesses/${businessId}/offers`, body),
  updateOffer: (id: string, body: PartnerOfferUpdate) =>
    patch<PartnerOfferOut>(`/partner-map/admin/offers/${id}`, body),
  deleteOffer: (id: string) => del<void>(`/partner-map/admin/offers/${id}`),
};
