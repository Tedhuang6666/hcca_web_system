import { del, get, post, patch } from "./core";
import type { LinkedEmailsRead, SecurityEventRead, UserSessionRead } from "@/lib/types";
import type { UserSummary } from "./core";

export const usersApi = {
  list: () => get<UserSummary[]>("/users"),
  /** 依關鍵字搜尋使用者（用於下拉選單）*/
  listForSearch: (keyword: string) => {
    const qs = keyword ? `?search=${encodeURIComponent(keyword)}` : "";
    return get<UserSummary[]>(`/users${qs}`);
  },
  /** 依 ID 批次取得使用者（用於回填已選名單）*/
  listByIds: (ids: string[]) => {
    if (ids.length === 0) return Promise.resolve([] as UserSummary[]);
    const qs = ids.map((id) => `ids=${encodeURIComponent(id)}`).join("&");
    return get<UserSummary[]>(`/users?${qs}`);
  },
  me: () => get<import("@/lib/types").UserRead>("/users/me"),
  updateMe: (body: {
    display_name?: string; student_id?: string;
    show_email?: boolean;
  }) => patch<import("@/lib/types").UserRead>("/users/me", body),
  myEmails: () => get<LinkedEmailsRead>("/users/me/emails"),
  requestEmailVerification: (email: string) =>
    post<{ message: string }>("/users/me/emails/verification", { email }),
  verifyEmail: (email: string, code: string) =>
    post<LinkedEmailsRead>("/users/me/emails/verify", { email, code }),
  setPrimaryEmail: (email: string) =>
    post<LinkedEmailsRead>("/users/me/emails/primary", { email }),
  unlinkEmail: (email: string) =>
    del<LinkedEmailsRead>(`/users/me/emails?email=${encodeURIComponent(email)}`),
  mySessions: () => get<UserSessionRead[]>("/users/me/sessions"),
  revokeOtherSessions: () => post<{ revoked_count: number }>("/users/me/sessions/revoke-others"),
  revokeAllSessions: () => post<{ revoked_count: number }>("/users/me/sessions/revoke-all"),
  securityEvents: () => get<SecurityEventRead[]>("/users/me/security-events"),
  myPositions: (activeOnly = false) =>
    get<import("@/lib/types").UserPositionRead[]>(
      `/user-positions/me?active_only=${activeOnly}`
    ),
};
