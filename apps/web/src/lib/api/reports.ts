import { get } from "./core";

// ── 預寫報表 ────────────────────────────────────────────────────────────
export interface ReportSummary {
  id: string;
  label: string;
  description: string;
}

export interface ReportResult {
  id: string;
  label: string;
  rows: Array<Record<string, unknown>>;
  row_count: number;
}

export const reportsApi = {
  list: () => get<ReportSummary[]>("/admin/reports"),
  run: (id: string) => get<ReportResult>(`/admin/reports/${encodeURIComponent(id)}`),
  csvUrl: (id: string) => `/admin/reports/${encodeURIComponent(id)}/csv`,
};
