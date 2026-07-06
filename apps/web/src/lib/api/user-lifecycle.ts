import { get, post } from "./core";

// ── 學籍異動 ────────────────────────────────────────────────────────────
export interface LifecycleStatus {
  user_id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  active_positions: Array<{
    user_position_id: string;
    position_id: string;
    start_date: string;
    end_date: string | null;
  }>;
}

export interface LifecycleActionResult {
  user_id: string;
  action: string;
  affected_positions: number;
  was_active: boolean;
  performed_at: string;
}

export const userLifecycleApi = {
  status: (user_id: string) =>
    get<LifecycleStatus>(`/admin/users/${encodeURIComponent(user_id)}/lifecycle/status`),
  freeze: (user_id: string, reason: string) =>
    post<LifecycleActionResult>(
      `/admin/users/${encodeURIComponent(user_id)}/lifecycle/freeze`,
      { reason },
    ),
  archiveAlumni: (user_id: string, reason: string) =>
    post<LifecycleActionResult>(
      `/admin/users/${encodeURIComponent(user_id)}/lifecycle/archive-alumni`,
      { reason },
    ),
  restore: (user_id: string, reason: string) =>
    post<LifecycleActionResult>(
      `/admin/users/${encodeURIComponent(user_id)}/lifecycle/restore`,
      { reason },
    ),
};
