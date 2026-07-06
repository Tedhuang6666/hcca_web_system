import type {
  EmailAnalyticsOut, EmailAttachmentOut, EmailCampaignRecipientOut, EmailComposePayload, EmailMessageCreate, EmailMessageDetailOut, EmailMessageOut, EmailPosition, EmailPreflightOut, EmailRecipientListOut, EmailTemplateOut, RecipientPreviewOut, RecipientSelector, UploadedImageOut,
} from "../types";
import { BASE, get, post, patch, del, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError } from "./core";

// ── 電子郵件 ──────────────────────────────────────────────────────────────────

export const emailApi = {
  previewRecipients: (sel: RecipientSelector) =>
    post<RecipientPreviewOut>("/email/preview-recipients", sel),
  preview: (body: EmailComposePayload) =>
    post<{ html: string }>("/email/preview", body),
  test: (body: EmailComposePayload) =>
    post<{ status: string; sent_to: string }>("/email/test", body),
  testSample: (
    body: EmailComposePayload & { recipient_indexes: number[]; test_emails: string[] },
  ) => post<{ status: string; queued: number; sent_to: string[] }>("/email/test-sample", body),
  preflight: (body: {
    recipient_spec: RecipientSelector;
    variable_definitions: EmailComposePayload["variable_definitions"];
    default_variables?: Record<string, string>;
    recipient_variables?: EmailComposePayload["recipient_variables"];
    attachment_ids?: string[];
  }) => post<EmailPreflightOut>("/email/preflight", body),
  createMessage: (body: EmailMessageCreate) =>
    post<EmailMessageOut>("/email/messages", body),
  updateMessage: (
    id: string,
    body: Partial<EmailComposePayload> & { scheduled_at?: string | null },
  ) => patch<EmailMessageOut>(`/email/messages/${id}`, body),
  sendMessage: (id: string) => post<EmailMessageOut>(`/email/messages/${id}/send`),
  resendMessage: (id: string) => post<EmailMessageOut>(`/email/messages/${id}/resend`),
  deleteMessage: (id: string) => del<void>(`/email/messages/${id}`),
  listDrafts: () => get<EmailMessageOut[]>("/email/drafts"),
  listMessages: (params?: {
    status?: string; limit?: number; offset?: number; q?: string;
    sender_id?: string; org_id?: string; template_id?: string;
    date_from?: string; date_to?: string; mine?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    if (params?.q) q.set("q", params.q);
    if (params?.sender_id) q.set("sender_id", params.sender_id);
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.template_id) q.set("template_id", params.template_id);
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    if (params?.mine) q.set("mine", "true");
    return get<EmailMessageOut[]>(`/email/messages${q.size ? `?${q}` : ""}`);
  },
  getMessage: (id: string) => get<EmailMessageDetailOut>(`/email/messages/${id}`),
  uploadImage: async (file: File): Promise<UploadedImageOut> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/email/images`, {
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
  },
  listMessageRecipients: (id: string, params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    return get<EmailCampaignRecipientOut[]>(
      `/email/messages/${id}/recipients${q.size ? `?${q}` : ""}`,
    );
  },
  previewMessageRecipient: (messageId: string, recipientId: string) =>
    get<{ html: string }>(
      `/email/messages/${messageId}/recipients/${recipientId}/preview`,
    ),
  listTemplates: () => get<EmailTemplateOut[]>("/email/templates"),
  createTemplate: (body: {
    name: string;
    description?: string;
    visibility: "private" | "org";
    org_id?: string | null;
    content: Partial<EmailComposePayload>;
    variable_definitions: EmailComposePayload["variable_definitions"];
    is_favorite?: boolean;
  }) => post<EmailTemplateOut>("/email/templates", body),
  updateTemplate: (id: string, body: Partial<EmailTemplateOut>) =>
    patch<EmailTemplateOut>(`/email/templates/${id}`, body),
  deleteTemplate: (id: string) => del<void>(`/email/templates/${id}`),
  listRecipientLists: () => get<EmailRecipientListOut[]>("/email/recipient-lists"),
  createRecipientList: (body: {
    name: string;
    description?: string;
    visibility: "private" | "org";
    org_id?: string | null;
    recipient_spec: RecipientSelector;
    variable_definitions: EmailComposePayload["variable_definitions"];
    members: EmailComposePayload["recipient_variables"];
  }) => post<EmailRecipientListOut>("/email/recipient-lists", body),
  updateRecipientList: (id: string, body: Partial<EmailRecipientListOut>) =>
    patch<EmailRecipientListOut>(`/email/recipient-lists/${id}`, body),
  deleteRecipientList: (id: string) => del<void>(`/email/recipient-lists/${id}`),
  uploadAttachment: async (file: File, templateId?: string): Promise<EmailAttachmentOut> => {
    const fd = new FormData();
    fd.append("file", file);
    const q = templateId ? `?template_id=${encodeURIComponent(templateId)}` : "";
    const doFetch = () =>
      fetch(`${BASE}/email/attachments${q}`, {
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
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.json();
  },
  revokeAttachment: (id: string) => del<void>(`/email/attachments/${id}`),
  getAnalytics: (id: string) => get<EmailAnalyticsOut>(`/email/messages/${id}/analytics`),
  cloneMessage: (id: string, audience: "all" | "unopened" | "undelivered") =>
    post<{ id: string }>(`/email/messages/${id}/clone?audience=${audience}`),
  exportUrl: (id: string, format: "csv" | "xlsx") =>
    `${BASE}/email/messages/${encodeURIComponent(id)}/export?format=${format}`,
  orgPositions: (orgId: string) => get<EmailPosition[]>(`/orgs/${orgId}/positions`),
};
