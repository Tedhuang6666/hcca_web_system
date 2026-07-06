import { get, post, patch } from "./core";
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
  myEmails: () => get<{ emails: string[] }>("/users/me/emails"),
  requestEmailVerification: (email: string) =>
    post<{ message: string }>("/users/me/emails/verification", { email }),
  verifyEmail: (email: string, code: string) =>
    post<{ emails: string[] }>("/users/me/emails/verify", { email, code }),
  myPositions: (activeOnly = false) =>
    get<import("@/lib/types").UserPositionRead[]>(
      `/user-positions/me?active_only=${activeOnly}`
    ),
};
