import type {
  PetitionCaseListItem, PetitionCaseOut, PetitionCreate, PetitionCreatedOut, PetitionStatsOut, PetitionStatus, PetitionTypeOut,
} from "../types";
import { BASE, get, post, patch, del, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError } from "./core";

// ── 陳情系統 ──────────────────────────────────────────────────────────────────

async function uploadPetitionFile<T>(path: string, fd: FormData): Promise<T> {
  const doFetch = () =>
    fetch(`${BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: csrfHeaders("POST"),
      body: fd,
    });
  let res = await doFetch();
  if (res.status === 401) {
    const ok = await silentRefresh();
    if (ok) res = await doFetch();
  }
  if (!res.ok) {
    throw new ApiError(res.status, await errorMessageFromResponse(res));
  }
  return res.json();
}

export const petitionsApi = {
  listTypes: () => get<PetitionTypeOut[]>("/petitions/types"),
  listAdminTypes: () => get<PetitionTypeOut[]>("/petitions/admin/types"),
  createType: (body: {
    name: string;
    description?: string | null;
    responsible_org_id: string;
    is_active?: boolean;
    sort_order?: number;
  }) => post<PetitionTypeOut>("/petitions/admin/types", body),
  updateType: (id: string, body: Partial<{
    name: string;
    description: string | null;
    responsible_org_id: string;
    is_active: boolean;
    sort_order: number;
  }>) => patch<PetitionTypeOut>(`/petitions/admin/types/${id}`, body),
  deleteType: (id: string) => del<void>(`/petitions/admin/types/${id}`),
  create: (body: PetitionCreate) => post<PetitionCreatedOut>("/petitions", body),
  lookup: (caseNumber: string, verificationCode: string) =>
    get<PetitionCaseOut>(
      `/petitions/lookup?${new URLSearchParams({ case_number: caseNumber, verification_code: verificationCode }).toString()}`
    ),
  directLookup: (caseNumber: string, verificationCode: string) =>
    get<PetitionCaseOut>(`/petitions/${caseNumber}/${verificationCode}`),
  my: (params?: { status?: PetitionStatus; keyword?: string }) => {
    const qs = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => Boolean(v)) as [string, string][]).toString()}` : "";
    return get<PetitionCaseListItem[]>(`/petitions/my${qs}`);
  },
  manage: (params?: { status?: PetitionStatus; keyword?: string; assigned_to_me?: boolean }) => {
    const p: Record<string, string> = {};
    if (params?.status) p.status = params.status;
    if (params?.keyword) p.keyword = params.keyword;
    if (params?.assigned_to_me !== undefined) p.assigned_to_me = String(params.assigned_to_me);
    const qs = Object.keys(p).length ? `?${new URLSearchParams(p).toString()}` : "";
    return get<PetitionCaseListItem[]>(`/petitions/manage${qs}`);
  },
  stats: () => get<PetitionStatsOut>("/petitions/stats"),
  get: (id: string) => get<PetitionCaseOut>(`/petitions/${id}`),
  assignableUsers: (id: string) =>
    get<{ id: string; display_name: string; email: string }[]>(`/petitions/${id}/assignable-users`),
  supplement: (id: string, body: { content: string; verification_code?: string | null }) =>
    post<PetitionCaseOut>(`/petitions/${id}/supplement`, body),
  assign: (id: string, body: { assigned_to_id: string; internal_note?: string | null }) =>
    patch<PetitionCaseOut>(`/petitions/${id}/assign`, body),
  transfer: (id: string, body: { to_org_id: string; reason: string }) =>
    patch<PetitionCaseOut>(`/petitions/${id}/transfer`, body),
  reply: (id: string, body: { public_content: string; internal_note?: string | null; resolve?: boolean }) =>
    post<PetitionCaseOut>(`/petitions/${id}/reply`, body),
  updateStatus: (id: string, body: { status: PetitionStatus; public_message?: string | null; internal_note?: string | null }) =>
    patch<PetitionCaseOut>(`/petitions/${id}/status`, body),
  addNote: (id: string, content: string) => post<PetitionCaseOut>(`/petitions/${id}/notes`, { content }),
  uploadAttachment: (id: string, file: File, options?: { verification_code?: string; visibility?: "public" | "internal" }) => {
    const fd = new FormData();
    fd.append("file", file);
    if (options?.verification_code) fd.append("verification_code", options.verification_code);
    if (options?.visibility) fd.append("visibility", options.visibility);
    return uploadPetitionFile<{ id: string; filename: string; url: string }>(`/petitions/${id}/attachments`, fd);
  },
  attachmentDownloadUrl: (id: string, attachmentId: string, verificationCode?: string) => {
    const qs = verificationCode ? `?${new URLSearchParams({ verification_code: verificationCode }).toString()}` : "";
    return `${BASE}/petitions/${id}/attachments/${attachmentId}/download${qs}`;
  },
};
