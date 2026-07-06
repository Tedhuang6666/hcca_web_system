import { get, post } from "./core";

// ── 個資處理（export + anonymize）────────────────────────────────────────
export interface PrivacyExportResult {
  user_id: string;
  file_path: string;
  size_bytes: number;
  file_count: number;
  generated_at: string;
}

export interface PrivacyExportFile {
  filename: string;
  size_bytes: number;
  modified_at: string;
}

export interface PrivacyAnonymizeResult {
  user_id: string;
  fields_updated: string[];
  anonymized_at: string;
}

export const privacyApi = {
  exportUser: (user_id: string) =>
    post<PrivacyExportResult>(
      `/admin/privacy/users/${encodeURIComponent(user_id)}/export`,
      {},
    ),
  anonymizeUser: (user_id: string, confirm_phrase: string) =>
    post<PrivacyAnonymizeResult>(
      `/admin/privacy/users/${encodeURIComponent(user_id)}/anonymize`,
      { confirm_phrase },
    ),
  listExports: () => get<PrivacyExportFile[]>("/admin/privacy/exports"),
  exportDownloadUrl: (filename: string) =>
    `/admin/privacy/exports/download?filename=${encodeURIComponent(filename)}`,
};
