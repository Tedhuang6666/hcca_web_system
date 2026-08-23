import type { DashboardCompositeResponse } from "../types";
import { get, request } from "./core";

export type { DashboardCompositeResponse } from "../types";

// ── 儀表板 / 待辦中心 ─────────────────────────────────────────────────────────

export type DashboardSeverity = "info" | "warning" | "critical";

export type DashboardLayoutHint = "student" | "officer" | "leader";

export interface DashboardWidgetItem {
  title: string;
  subtitle: string | null;
  href: string | null;
  timestamp: string | null;
  badge: string | null;
  priority_score: number;
  priority_reasons: string[];
  recommended_action: string | null;
}

export interface DashboardWidget {
  key: string;
  title: string;
  summary: string | null;
  count: number | null;
  href: string | null;
  severity: DashboardSeverity;
  wide: boolean;
  items: DashboardWidgetItem[];
  priority_score: number;
  priority_reasons: string[];
  recommended_action: string | null;
}

export interface DashboardResponse {
  widgets: DashboardWidget[];
  layout_hint: DashboardLayoutHint;
}

export const dashboardApi = {
  get: () => get<DashboardResponse>("/dashboard"),
  composite: (options?: {
    includeTasks?: boolean;
    includeMatters?: boolean;
    includeAnnouncements?: boolean;
    compactDashboard?: boolean;
  }) => {
    const query = new URLSearchParams();
    if (options?.includeTasks === false) query.set("include_tasks", "false");
    if (options?.includeMatters !== undefined) {
      query.set("include_matters", String(options.includeMatters));
    }
    if (options?.includeAnnouncements === false) query.set("include_announcements", "false");
    if (options?.compactDashboard) query.set("compact_dashboard", "true");
    const queryString = query.toString();
    const userId = typeof window === "undefined" ? null : localStorage.getItem("user_id");
    return request<DashboardCompositeResponse>(
      `/dashboard/composite${queryString ? `?${queryString}` : ""}`,
      userId ? { headers: { "X-HCCA-Cache-User": userId } } : undefined,
    );
  },
};
