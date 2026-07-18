import type {
  BatchDocumentOperationOut, DocumentApprovalDelegationOut, DocumentCreate, DocumentListItem, DocumentOut,
} from "../types";
import { BASE, get, post, patch, del, request, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError } from "./core";

// ── 公文 ──────────────────────────────────────────────────────────────────────

export interface DocumentStats {
  draft: number;
  pending_submitted: number;
  pending_my_approval: number;
  approved_this_month: number;
  rejected: number;
}

export const documentsApi = {
  stats: () => get<DocumentStats>("/documents/stats"),
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<DocumentListItem[]>(`/documents${qs}`);
  },
  get: (id: string) => get<DocumentOut>(`/documents/${id}`),
  create: (body: DocumentCreate) => post<DocumentOut>("/documents", body),
  update: (id: string, body: Partial<DocumentCreate> & { change_note?: string; autosave?: boolean }) =>
    patch<DocumentOut>(`/documents/${id}`, body),
  delete: (id: string) => del<void>(`/documents/${id}`),
  submit: (id: string, approver_ids: string[]) =>
    post<DocumentOut>(`/documents/${id}/submit`, { approver_ids }),
  approve: (id: string, comment?: string) =>
    post<DocumentOut>(`/documents/${id}/approve`, { comment }),
  reject: (id: string, comment: string, mode: "to_creator" | "to_previous" = "to_creator") =>
    post<DocumentOut>(`/documents/${id}/reject`, { comment, mode }),
  recall: (id: string) => post<DocumentOut>(`/documents/${id}/recall`),
  archive: (id: string) => post<DocumentOut>(`/documents/${id}/archive`),
  batchApprove: (document_ids: string[], comment?: string) =>
    post<BatchDocumentOperationOut>("/documents/batch/approve", { document_ids, comment }),
  batchReject: (
    document_ids: string[],
    comment: string,
    mode: "to_creator" | "to_previous" = "to_creator",
  ) => post<BatchDocumentOperationOut>("/documents/batch/reject", { document_ids, comment, mode }),
  batchArchive: (document_ids: string[]) =>
    post<BatchDocumentOperationOut>("/documents/batch/archive", { document_ids }),
  batchDelegate: (document_ids: string[], delegate_id: string | null, step_order?: number) =>
    post<BatchDocumentOperationOut>("/documents/batch/delegate", {
      document_ids,
      delegate_id,
      step_order,
    }),
  issueDirect: (id: string, comment?: string) =>
    post<DocumentOut>(`/documents/${id}/issue-direct`, { comment }),
  suggestApprovers: (id: string) =>
    get<{ id: string; display_name: string; email: string }[]>(`/documents/${id}/suggest-approvers`),
  setDelegate: (id: string, stepOrder: number, delegateId: string | null) =>
    request<DocumentOut>(`/documents/${id}/approvals/${stepOrder}/delegate`, {
      method: "PUT",
      body: JSON.stringify({ delegate_id: delegateId }),
    }),
  listDelegations: (params?: { org_id?: string; principal_user_id?: string; include_inactive?: boolean }) => {
    const p: Record<string, string> = {};
    if (params?.org_id) p.org_id = params.org_id;
    if (params?.principal_user_id) p.principal_user_id = params.principal_user_id;
    if (params?.include_inactive !== undefined) p.include_inactive = String(params.include_inactive);
    const qs = Object.keys(p).length ? `?${new URLSearchParams(p).toString()}` : "";
    return get<DocumentApprovalDelegationOut[]>(`/documents/management/delegations${qs}`);
  },
  createDelegation: (body: {
    org_id: string;
    delegate_user_id: string;
    start_at: string;
    end_at?: string | null;
    reason?: string | null;
  }) => post<DocumentApprovalDelegationOut>("/documents/management/delegations", body),
  updateDelegation: (id: string, body: Partial<{
    delegate_user_id: string | null;
    start_at: string | null;
    end_at: string | null;
    reason: string | null;
    is_active: boolean;
  }>) => patch<DocumentApprovalDelegationOut>(`/documents/management/delegations/${id}`, body),
  deleteDelegation: (id: string) => del<void>(`/documents/management/delegations/${id}`),
  uploadAttachment: async (id: string, file: File): Promise<{ id: string; filename: string; display_name: string | null; url: string }> => {
    // 不使用 request() — 它會強制 Content-Type: application/json，
    // 導致 browser 無法自動設定 multipart/form-data boundary，後端收到 422。
    // 此處直接用 fetch，讓 browser 自動處理 multipart Content-Type。
    const fd = new FormData();
    fd.append("file", file);

    const doFetch = () =>
      fetch(`${BASE}/documents/${id}/attachments`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      });

    let res = await doFetch();

    if (res.status === 401) {
      const ok = await silentRefresh();
      if (ok) {
        res = await doFetch();
      } else {
        if (typeof window !== "undefined" && localStorage.getItem("user_id")) {
          window.location.replace("/login");
        }
        throw new ApiError(401, "登入已過期，請重新登入");
      }
    }

    if (!res.ok) {
      throw new ApiError(res.status, await errorMessageFromResponse(res));
    }
    return res.json();
  },
  addLink: (id: string, body: { url: string; display_text?: string }) =>
    post<{ id: string; filename: string; link_url: string | null }>(`/documents/${id}/attachments/link`, body),
  renameAttachment: (id: string, attachmentId: string, filename: string) =>
    patch<{ id: string; filename: string; display_name: string | null }>(
      `/documents/${id}/attachments/${attachmentId}`,
      { filename },
    ),
  deleteAttachment: (id: string, attachmentId: string) =>
    del<void>(`/documents/${id}/attachments/${attachmentId}`),
  attachmentDownloadUrl: (id: string, attachmentId: string) =>
    `${BASE}/documents/${id}/attachments/${attachmentId}/download`,
  attachmentPreviewUrl: (id: string, attachmentId: string) =>
    `${BASE}/documents/${id}/attachments/${attachmentId}/preview`,
  /** 後端列印 / 下載 PDF（一般使用者由身份自動判定正/影本；管理員可指定）。 */
  printPdf: async (
    id: string,
    opts?: { recipientId?: string; variant?: "primary" | "copy" },
  ): Promise<Blob> => {
    const qs = new URLSearchParams();
    if (opts?.recipientId) qs.set("recipient_id", opts.recipientId);
    if (opts?.variant) qs.set("variant", opts.variant);
    const url = `${BASE}/documents/${id}/print${qs.toString() ? `?${qs}` : ""}`;
    const res = await fetch(url, {
      credentials: "include",
    });
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.blob();
  },
};
