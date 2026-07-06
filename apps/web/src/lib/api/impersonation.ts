import { post } from "./core";

// ── Impersonation ────────────────────────────────────────────────────────
export interface ImpersonationStartResponse {
  token: string;
  expires_in_minutes: number;
  target_user_id: string;
  target_email: string;
}

export const impersonationApi = {
  start: (target_user_id: string, minutes: number) =>
    post<ImpersonationStartResponse>(
      `/admin/impersonate/${encodeURIComponent(target_user_id)}`,
      { minutes },
    ),
  end: (token: string, reason: string) =>
    post<void>("/admin/impersonate/end", { token, reason }),
};
