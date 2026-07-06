import { get } from "./core";

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
};
