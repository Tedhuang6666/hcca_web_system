import type {
  PartnerBusinessCreate,
  PartnerBusinessOut,
  PartnerBusinessUpdate,
  PartnerMapItem,
  RecommendedVendorListItem,
  RecommendedVendorOut,
} from "./types";

export type BusinessHourDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type BusinessHoursInterval = {
  open: string;
  close: string;
};

export type BusinessHours = Partial<Record<BusinessHourDay, BusinessHoursInterval[]>>;

export type UnifiedMapItem = PartnerMapItem & {
  source?: "partner" | "recommended";
  business_hours?: BusinessHours;
  has_discount_offer?: boolean;
};

export type RecommendedVendorListItemWithHours = RecommendedVendorListItem & {
  business_hours?: BusinessHours;
};

export type RecommendedVendorOutWithHours = RecommendedVendorOut & {
  business_hours?: BusinessHours;
};

export type PartnerBusinessOutWithHours = PartnerBusinessOut & {
  business_hours?: BusinessHours;
};

export type PartnerBusinessCreateWithHours = PartnerBusinessCreate & {
  business_hours?: BusinessHours;
};

export type PartnerBusinessUpdateWithHours = PartnerBusinessUpdate & {
  business_hours?: BusinessHours | null;
};

export type PartnerBusinessSelfUpdate = {
  name?: string | null;
  summary?: string | null;
  description?: string | null;
  website_url?: string | null;
  social_url?: string | null;
  logo_url?: string | null;
  cover_image_url?: string | null;
  category?: string | null;
  business_hours_text?: string | null;
  business_hours?: BusinessHours | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  instagram_handle?: string | null;
  line_id?: string | null;
  other_contact?: string | null;
};

export type RecommendedVendorCreateWithHours = import("./types").RecommendedVendorCreate & {
  business_hours?: BusinessHours;
};

export type RecommendedVendorUpdateWithHours = import("./types").RecommendedVendorUpdate & {
  business_hours?: BusinessHours | null;
};

export type PartnerBusinessAccount = {
  id: string;
  business_id: string;
  user_id: string;
  display_name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
