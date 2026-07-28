import type {
  PartnerApplicationPortalOut,
  PartnerApplicationFieldConfig,
  PartnerApplicationSettingsOut,
  PartnerBusinessApplicationOut,
  PartnerBusinessApplicationStatus,
} from "../types";
import { get, patch, post } from "./core";

export const partnerApplicationApi = {
  portal: () => get<PartnerApplicationPortalOut>("/partner-map/applications/portal"),
  submit: (body: { field_values: Record<string, string> }) =>
    post<PartnerBusinessApplicationOut>("/partner-map/applications", body),
  adminSettings: () =>
    get<PartnerApplicationSettingsOut>("/partner-map/admin/applications/settings"),
  updateSettings: (body: {
    is_open?: boolean;
    title?: string;
    intro?: string;
    privacy_notice?: string | null;
    fields?: PartnerApplicationFieldConfig[];
  }) => patch<PartnerApplicationSettingsOut>("/partner-map/admin/applications/settings", body),
  adminList: (status?: PartnerBusinessApplicationStatus | "") =>
    get<PartnerBusinessApplicationOut[]>(
      `/partner-map/admin/applications${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    ),
  review: (
    id: string,
    body: { status: PartnerBusinessApplicationStatus; review_note?: string | null },
  ) => patch<PartnerBusinessApplicationOut>(`/partner-map/admin/applications/${id}`, body),
};
