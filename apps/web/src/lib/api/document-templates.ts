import type {
  DocumentOut, DocumentTemplateCreate, DocumentTemplateOut, DocumentTemplateUpdate,
} from "../types";
import { get, post, patch, del } from "./core";

// ── 公文範本庫 ────────────────────────────────────────────────────────────────

export const documentTemplatesApi = {
  list: (params?: {
    org_id?: string;
    category?: string;
    active_only?: boolean;
    keyword?: string;
    limit?: number;
    offset?: number;
  }) => {
    const p: Record<string, string> = {};
    if (params?.org_id) p.org_id = params.org_id;
    if (params?.category) p.category = params.category;
    if (params?.active_only !== undefined) p.active_only = String(params.active_only);
    if (params?.keyword) p.keyword = params.keyword;
    if (params?.limit !== undefined) p.limit = String(params.limit);
    if (params?.offset !== undefined) p.offset = String(params.offset);
    const qs = Object.keys(p).length ? "?" + new URLSearchParams(p).toString() : "";
    return get<DocumentTemplateOut[]>(`/document-templates${qs}`);
  },
  get: (id: string) => get<DocumentTemplateOut>(`/document-templates/${id}`),
  create: (body: DocumentTemplateCreate) => post<DocumentTemplateOut>("/document-templates", body),
  update: (id: string, body: DocumentTemplateUpdate) =>
    patch<DocumentTemplateOut>(`/document-templates/${id}`, body),
  deactivate: (id: string) => del<void>(`/document-templates/${id}`),
  createDraft: (
    id: string,
    body: {
      title?: string;
      serial_template_id?: string | null;
      handler_name?: string;
      handler_email?: string;
      due_date?: string;
      meeting_time?: string;
      recipients?: { recipient_type: string; name: string; email?: string | null }[];
    } = {},
  ) => post<DocumentOut>(`/document-templates/${id}/draft`, body),
};
