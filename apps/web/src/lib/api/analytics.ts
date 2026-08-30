import type {
  AnalyticsInsightsOut,
  AnnouncementParticipationItem,
  ArticleAnalyticsOut,
  DeptRankingItem,
  DocumentEfficiencyOut,
  PendingAlertItem,
  ProductAnalyticsOut,
  SurveyParticipationItem,
} from "../types";
import { BASE, get, post } from "./core";

function hasCsrfCookie(): boolean {
  return typeof document !== "undefined"
    && document.cookie.split(";").some((item) => item.trim().startsWith("csrf_token="));
}

async function ensureCsrfCookie(): Promise<boolean> {
  if (typeof document === "undefined" || hasCsrfCookie()) return true;
  try {
    await fetch(`${BASE}/ready`, { credentials: "include", cache: "no-store" });
  } catch {
    return false;
  }
  return hasCsrfCookie();
}

export const analyticsApi = {
  article: (params?: { date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    return get<ArticleAnalyticsOut>(`/analytics/articles${q.size ? `?${q}` : ""}`);
  },
  trackArticleView: (slug: string, visitorId: string, deviceClass: "mobile" | "tablet" | "desktop") =>
    post<void>(`/site/pages/${encodeURIComponent(slug)}/view`, {
      visitor_id: visitorId,
      device_class: deviceClass,
    }),
  product: (params?: { date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    return get<ProductAnalyticsOut>(`/analytics/product${q.size ? `?${q}` : ""}`);
  },
  trackPageView: async (path: string) => {
    // analytics_page_views.path is intentionally bounded; oversized editor URLs
    // should never turn a background telemetry request into a 422.
    const boundedPath = path.length > 255 ? `${path.slice(0, 252)}...` : path;
    if (!(await ensureCsrfCookie())) return;
    return post<void>("/analytics/page-views", { path: boundedPath });
  },
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
