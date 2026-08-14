import type {
  ClassCadreOut, ClassManualMemberOut, ClassMemberOut, ClassMembershipOut, ClassRoleOut, ClassRosterBulkCreate, ClassRosterBulkOut, ClassRosterEntryOut, ClassRosterPdfImportOut, ClassStudentRangeOut, SchoolClassBulkActionKind, SchoolClassBulkActionOut, SchoolClassBulkCreate, SchoolClassBulkCreateOut, SchoolClassListItem, SchoolClassOut,
} from "../types";
import { ApiError } from "../api-helpers";
import {
  BASE,
  csrfHeaders,
  del,
  formatErrorDetail,
  get,
  patch,
  post,
  silentRefresh,
  uploadWithProgress,
} from "./core";

async function postForm<T>(path: string, body: FormData, onProgress?: (progress: number) => void, retried = false): Promise<T> {
  const response = await uploadWithProgress(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: csrfHeaders("POST"),
    body,
  }, onProgress);
  if (response.status === 401 && !retried && await silentRefresh()) {
    return postForm<T>(path, body, onProgress, true);
  }
  if (!response.ok) {
    let detail: unknown = response.statusText;
    try {
      const payload = await response.json() as { detail?: unknown };
      detail = payload.detail ?? detail;
    } catch {
      // Keep the HTTP status text when the server returns a non-JSON error.
    }
    throw new ApiError(response.status, formatErrorDetail(detail, "檔案匯入失敗"));
  }
  return response.json() as Promise<T>;
}

// ── 班級 ──────────────────────────────────────────────────────────────────────

export const classApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<SchoolClassListItem[]>(`/classes${qs}`);
  },
  recipientOptions: () => get<SchoolClassListItem[]>('/classes/recipient-options'),
  get: (id: string) => get<SchoolClassOut>(`/classes/${id}`),
  myClass: () => get<SchoolClassListItem | null>("/classes/me"),
  create: (body: Record<string, unknown>) => post<SchoolClassOut>("/classes", body),
  bulkCreate: (body: SchoolClassBulkCreate) => post<SchoolClassBulkCreateOut>("/classes/bulk", body),
  bulkAction: (classIds: string[], action: SchoolClassBulkActionKind) =>
    post<SchoolClassBulkActionOut>("/classes/bulk/action", { class_ids: classIds, action }),
  update: (id: string, body: Record<string, unknown>) =>
    patch<SchoolClassOut>(`/classes/${id}`, body),
  remove: (id: string) => del<void>(`/classes/${id}`),
  members: (id: string) => get<ClassMemberOut[]>(`/classes/${id}/members`),
  memberships: (id: string) => get<ClassMembershipOut[]>(`/classes/${id}/memberships`),
  roster: (id: string) => get<ClassRosterEntryOut[]>(`/classes/${id}/roster`),
  addRoster: (id: string, body: { seat_number: number; student_id: string }) =>
    post<ClassRosterEntryOut>(`/classes/${id}/roster`, body),
  bulkRoster: (id: string, body: ClassRosterBulkCreate) =>
    post<ClassRosterBulkOut>(`/classes/${id}/roster/bulk`, body),
  importRosterFile: (file: File, academicYear?: number, onProgress?: (progress: number) => void) => {
    const form = new FormData();
    form.append("file", file);
    if (academicYear) form.append("academic_year", String(academicYear));
    return postForm<ClassRosterPdfImportOut>("/classes/roster/import", form, onProgress);
  },
  updateRoster: (id: string, entryId: string, body: { seat_number?: number; student_id?: string }) =>
    patch<ClassRosterEntryOut>(`/classes/${id}/roster/${entryId}`, body),
  deleteRoster: (id: string, entryId: string) => del<void>(`/classes/${id}/roster/${entryId}`),
  addMembership: (id: string, body: { user_id: string; source?: string; start_date?: string | null }) =>
    post<ClassMembershipOut>(`/classes/${id}/memberships`, body),
  endMembership: (id: string, userId: string) =>
    del<void>(`/classes/${id}/memberships/${userId}`),
  roles: (id: string) => get<ClassRoleOut[]>(`/classes/${id}/roles`),
  assignRole: (id: string, roleKey: string, body: { user_id: string; start_date?: string | null; end_date?: string | null }) =>
    post<{ user_position_id: string; position_id: string }>(`/classes/${id}/roles/${roleKey}/assign`, body),
  addMember: (id: string, userId: string) =>
    post<ClassManualMemberOut>(`/classes/${id}/members`, { user_id: userId }),
  removeMember: (id: string, userId: string) => del<void>(`/classes/${id}/members/${userId}`),
  addRange: (id: string, body: { student_id_start: string; student_id_end: string }) =>
    post<ClassStudentRangeOut>(`/classes/${id}/ranges`, body),
  deleteRange: (id: string, rangeId: string) => del<void>(`/classes/${id}/ranges/${rangeId}`),
  addCadre: (id: string, userId: string) =>
    post<ClassCadreOut>(`/classes/${id}/cadres`, { user_id: userId }),
  removeCadre: (id: string, userId: string) => del<void>(`/classes/${id}/cadres/${userId}`),
};
