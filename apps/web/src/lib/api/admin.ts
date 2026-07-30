import type {
  AccountMergePreview, AdminUserDetail, MeetingBillStage, OrgRead, OrgWithPositions, PermissionCodeInfo, PositionCategory, PositionSummary, UserBatchPreRegisterResult,
} from "../types";
import { get, post, patch, del, request } from "./core";

export const adminApi = {
  // 使用者
  listUsers: (params?: { keyword?: string; active_only?: boolean; limit?: number; offset?: number }) => {
    const p: Record<string, string> = {};
    if (params?.keyword) p.keyword = params.keyword;
    if (params?.active_only !== undefined) p.active_only = String(params.active_only);
    if (params?.limit !== undefined) p.limit = String(params.limit);
    if (params?.offset !== undefined) p.offset = String(params.offset);
    const qs = Object.keys(p).length ? "?" + new URLSearchParams(p).toString() : "";
    return get<AdminUserDetail[]>(`/admin/users${qs}`);
  },
  getUser: (id: string) => get<AdminUserDetail>(`/admin/users/${id}`),
  preRegister: (body: {
    student_id?: string | null; email?: string | null; display_name: string;
    linked_emails?: string[];
    position_ids?: string[]; start_date?: string; end_date?: string | null;
    custom_permission_org_id?: string | null;
    custom_permission_codes?: string[];
  }) => post<AdminUserDetail>("/admin/users/pre-register", body),
  batchPreRegister: (body: {
    users: {
      student_id?: string | null; email?: string | null; display_name: string;
      linked_emails?: string[];
      position_ids?: string[]; start_date?: string; end_date?: string | null;
    }[];
  }) => post<UserBatchPreRegisterResult>("/admin/users/pre-register/batch", body),
  linkUserEmails: (id: string, emails: string[]) =>
    post<AdminUserDetail>(`/admin/users/${id}/emails`, { emails }),
  previewUserMerge: (id: string, sourceUserIds: string[]) =>
    post<AccountMergePreview>(`/admin/users/${id}/merge/preview`, { source_user_ids: sourceUserIds }),
  mergeUserAccounts: (
    id: string,
    sourceUserIds: string[],
  ) =>
    post<AdminUserDetail>(`/admin/users/${id}/merge`, {
      source_user_ids: sourceUserIds,
    }),
  updateUser: (id: string, body: {
    display_name?: string;
    student_id?: string | null;
    is_active?: boolean;
    is_verified?: boolean;
    show_email?: boolean;
    ui_theme?: "auto" | "light" | "dark";
    ui_locale?: "zh-TW";
    is_superuser?: boolean;
    notification_preferences?: Record<string, {
      inapp: boolean;
      email: boolean;
      line: boolean;
      discord: boolean;
    }>;
    notification_digest_frequency?: "off" | "daily" | "weekly";
    muted_notification_modules?: string[];
  }) =>
    patch<AdminUserDetail>(`/admin/users/${id}`, body),
  clearUserMfa: (id: string) => del<AdminUserDetail>(`/admin/users/${id}/mfa`),
  revokeUserSessions: (id: string) =>
    post<{ user_id: string; revoked_count: number }>(`/admin/users/${id}/sessions/revoke`, {}),
  addUserPosition: (userId: string, body: { position_id: string; start_date?: string; end_date?: string | null }) =>
    post<AdminUserDetail>(`/admin/users/${userId}/positions`, body),
  updateUserPosition: (
    userId: string,
    upId: string,
    body: { start_date?: string; end_date?: string | null },
  ) => patch<AdminUserDetail>(`/admin/users/${userId}/positions/${upId}`, body),
  removeUserPosition: (userId: string, upId: string) =>
    del<void>(`/admin/users/${userId}/positions/${upId}`),

  // 職位
  // 建立職位頁面與管理工作台會連續讀取此列表；禁止瀏覽器沿用建立前的 GET 回應。
  listPositions: () => request<PositionSummary[]>("/admin/positions?limit=500", { cache: "no-store" }),
  createPosition: (body: {
    org_id: string;
    name: string;
    description?: string;
    category?: PositionCategory;
    weight?: number;
    parent_id?: string | null;
    permission_codes?: string[];
  }) =>
    post<PositionSummary>("/admin/positions", body),
  updatePosition: (
    id: string,
    body: {
      name?: string;
      description?: string | null;
      category?: PositionCategory;
      weight?: number;
      parent_id?: string | null;
    },
  ) => patch<PositionSummary>(`/admin/positions/${id}`, body),
  replacePositionPermissions: (id: string, codes: string[]) =>
    request<PositionSummary>(`/admin/positions/${id}/permissions`, {
      method: "PUT", body: JSON.stringify(codes),
    }),
  copyPositionPermissions: (id: string, sourcePositionId: string) =>
    post<PositionSummary>(`/admin/positions/${id}/permissions/copy`, {
      source_position_id: sourcePositionId,
    }),
  deletePosition: (id: string) => del<void>(`/admin/positions/${id}`),

  // 系統資訊
  listPermissionCodes: () => get<PermissionCodeInfo[]>("/admin/permission-codes"),
  queryPermissionCodes: (params?: {
    group?: string;
    keyword?: string;
    sort_by?: "group" | "code" | "label";
    order?: "asc" | "desc";
  }) => {
    const q = new URLSearchParams();
    if (params?.group) q.set("group", params.group);
    if (params?.keyword) q.set("keyword", params.keyword);
    if (params?.sort_by) q.set("sort_by", params.sort_by);
    if (params?.order) q.set("order", params.order);
    const qs = q.toString();
    return get<PermissionCodeInfo[]>(`/admin/permission-codes/query${qs ? `?${qs}` : ""}`);
  },
  listOrgsWithPositions: () => get<OrgWithPositions[]>("/admin/orgs-with-positions"),

  // 組織管理
  createOrg: (body: {
    name: string;
    description?: string;
    parent_id?: string | null;
    prefix?: string | null;
    bill_stage?: MeetingBillStage | null;
    leader_user_id?: string | null;
    default_permission_codes?: string[];
  }) => post<OrgRead>("/orgs", body),
  updateOrg: (id: string, body: {
    name?: string;
    description?: string | null;
    parent_id?: string | null;
    prefix?: string | null;
    bill_stage?: MeetingBillStage | null;
    leader_user_id?: string | null;
    default_permission_codes?: string[];
    note?: string | null;
    remark?: string | null;
    is_active?: boolean;
  }) => patch<OrgRead>(`/orgs/${id}`, body),
  deleteOrg: (id: string) => del<void>(`/orgs/${id}`),
  deactivateOrg: (id: string) => post<OrgRead>(`/orgs/${id}/deactivate`, {}),
  activateOrg: (id: string) => post<OrgRead>(`/orgs/${id}/activate`, {}),
};
