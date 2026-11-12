import { get, patch, post } from "./core";

export type SiteReportKind = "vulnerability" | "bug";
export type SiteReportSeverity = "low" | "medium" | "high" | "critical";
export type SiteReportStatus =
  | "new"
  | "triaged"
  | "in_progress"
  | "resolved"
  | "wont_fix"
  | "duplicate";

export interface SiteReportOption {
  value: string;
  label: string;
  description: string;
}

export interface SiteReportPortal {
  is_open: boolean;
  notice: string;
  kinds: SiteReportOption[];
  severities: SiteReportOption[];
}

export interface SiteReportCreate {
  kind: SiteReportKind;
  severity: SiteReportSeverity;
  title: string;
  description: string;
  steps_to_reproduce?: string | null;
  affected_url?: string | null;
  contact_email?: string | null;
  website?: string | null;
}

export interface SiteReportCreated {
  id: string;
  reference_code: string;
  created_at: string;
}

export interface SiteReport {
  id: string;
  reference_code: string;
  kind: SiteReportKind;
  severity: SiteReportSeverity;
  status: SiteReportStatus;
  title: string;
  description: string;
  steps_to_reproduce: string | null;
  affected_url: string | null;
  contact_email: string | null;
  reporter_id: string | null;
  user_agent: string | null;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SiteReportUpdate {
  status?: SiteReportStatus;
  severity?: SiteReportSeverity;
  admin_note?: string | null;
}

export const siteReportsApi = {
  portal: () => get<SiteReportPortal>("/site-reports/portal"),
  create: (body: SiteReportCreate) => post<SiteReportCreated>("/site-reports", body),
  adminList: (filters?: { status?: SiteReportStatus | ""; kind?: SiteReportKind | "" }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.kind) params.set("kind", filters.kind);
    const query = params.toString();
    return get<SiteReport[]>(`/site-reports/admin${query ? `?${query}` : ""}`);
  },
  update: (id: string, body: SiteReportUpdate) =>
    patch<SiteReport>(`/site-reports/admin/${id}`, body),
};
