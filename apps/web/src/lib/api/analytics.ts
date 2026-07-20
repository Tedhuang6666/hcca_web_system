import type {
  AnalyticsInsightsOut,
  AnnouncementParticipationItem,
  DeptRankingItem,
  DocumentEfficiencyOut,
  PendingAlertItem,
  ProductAnalyticsOut,
  SurveyParticipationItem,
} from "../types";
import { get, post } from "./core";

export const analyticsApi = {
  product: (params?: { date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    return get<ProductAnalyticsOut>(`/analytics/product${q.size ? `?${q}` : ""}`);
  },
  trackPageView: (path: string) => post<void>("/analytics/page-views", { path }),
  documentEfficiency: (params?: { org_id?: string; date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    return get<DocumentEfficiencyOut>(`/analytics/documents/efficiency${q.size ? `?${q}` : ""}`);
  },
  deptRanking: (params?: { date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    return get<DeptRankingItem[]>(`/analytics/documents/dept-ranking${q.size ? `?${q}` : ""}`);
  },
  pendingAlerts: (threshold_hours = 48) =>
    get<PendingAlertItem[]>(`/analytics/documents/pending-alerts?threshold_hours=${threshold_hours}`),
  insights: (limit = 20) =>
    get<AnalyticsInsightsOut>(`/analytics/insights?limit=${limit}`),
  announcementParticipation: (params?: {
    org_id?: string; date_from?: string; date_to?: string; limit?: number
  }) => {
    const q = new URLSearchParams();
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    if (params?.limit) q.set("limit", String(params.limit));
    return get<AnnouncementParticipationItem[]>(
      `/analytics/announcements/participation${q.size ? `?${q}` : ""}`
    );
  },
  surveyParticipation: (params?: {
    org_id?: string; date_from?: string; date_to?: string; limit?: number
  }) => {
    const q = new URLSearchParams();
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    if (params?.limit) q.set("limit", String(params.limit));
    return get<SurveyParticipationItem[]>(
      `/analytics/surveys/participation${q.size ? `?${q}` : ""}`
    );
  },
};
