import { get, post } from "./core";

// ── 資料生命週期（archive + purge）────────────────────────────────────────
export type LifecycleAction = "archive" | "purge" | "archive_then_purge";

export interface LifecycleRuleSummary {
  id: string;
  label: string;
  description: string;
  default_retention_days: number;
  min_retention_days: number;
  default_action: LifecycleAction;
  danger_level: "safe" | "caution" | "dangerous";
  extra_filter: string | null;
  affects_modules: string[];
  matched_count: number;
}

export interface LifecyclePreviewResult {
  rule_id: string;
  retention_days: number;
  cutoff_at: string;
  matched_count: number;
  sample: Array<Record<string, unknown>>;
}

export interface LifecycleExecuteResult {
  rule_id: string;
  action: LifecycleAction;
  retention_days: number;
  cutoff_at: string;
  matched_count: number;
  archived_count: number;
  purged_count: number;
  archive_file: string | null;
  started_at: string;
  finished_at: string;
}

export interface LifecycleArchiveFile {
  path: string;
  size_bytes: number;
  modified_at: string;
}

export const lifecycleApi = {
  listRules: () => get<LifecycleRuleSummary[]>("/admin/lifecycle/rules"),
  preview: (rule_id: string, retention_days?: number) =>
    post<LifecyclePreviewResult>(
      `/admin/lifecycle/rules/${encodeURIComponent(rule_id)}/preview`,
      { retention_days: retention_days ?? null },
    ),
  execute: (
    rule_id: string,
    body: {
      action?: LifecycleAction;
      retention_days?: number;
      batch_size?: number;
      max_batches?: number;
    },
  ) =>
    post<LifecycleExecuteResult>(
      `/admin/lifecycle/rules/${encodeURIComponent(rule_id)}/execute`,
      body,
    ),
  listArchives: () => get<LifecycleArchiveFile[]>("/admin/lifecycle/archives"),
  previewArchive: (path: string, limit = 50) =>
    get<Array<Record<string, unknown>>>(
      `/admin/lifecycle/archives/preview?path=${encodeURIComponent(path)}&limit=${limit}`,
    ),
  archiveDownloadUrl: (path: string) =>
    `/admin/lifecycle/archives/download?path=${encodeURIComponent(path)}`,
};
