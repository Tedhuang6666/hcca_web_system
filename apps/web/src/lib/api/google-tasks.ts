import { get, post, del } from "./core";
import { apiUrl } from "../config";

// ── Google Tasks 整合 ─────────────────────────────────────────────────────────

export type GoogleTasksStatus = {
  is_connected: boolean;
  authorized_email: string | null;
  sync_enabled: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  authorized_at: string | null;
};

export type GoogleTasksSyncResult = {
  pushed: number;
  pulled_created: number;
  pulled_skipped: number;
  errors: number;
};

export const googleTasksApi = {
  status: () => get<GoogleTasksStatus>("/user/google-tasks/status"),
  authorizeUrl: () => apiUrl("/user/google-tasks/authorize"),
  disconnect: () => del<void>("/user/google-tasks/disconnect"),
  sync: () => post<GoogleTasksSyncResult>("/user/google-tasks/sync", {}),
};
