import { post, request } from "./core";
import type { ImpersonationStartResponse } from "../types";

// ── Impersonation ────────────────────────────────────────────────────────
export type { ImpersonationStartResponse } from "../types";

export const impersonationApi = {
  start: (target_user_id: string, minutes: number) =>
    post<ImpersonationStartResponse>(
      `/admin/impersonate/${encodeURIComponent(target_user_id)}`,
      { minutes },
    ),
  end: (token: string, reason: string) =>
    request<void>("/admin/impersonate/end", {
      method: "POST",
      body: JSON.stringify({ token, reason }),
      skipImpersonation: true,
    }),
};
