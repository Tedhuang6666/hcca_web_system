import type {
  AmendmentComparisonRow, RegulationArticleOut, RegulationCategory, RegulationListItem, RegulationOut, RegulationRevisionOut, RegulationSearchResult, RegulationTreeNodeOut, RegulationWorkflowLogOut,
} from "../types";
import { BASE, get, post, patch, put, del, csrfHeaders, silentRefresh, errorMessageFromResponse, ApiError, pathSegment } from "./core";

// ── 法規 ──────────────────────────────────────────────────────────────────────

export interface RegulationImportItem {
  filename: string | null;
  ok: boolean;
  regulation: RegulationOut | null;
  detail: string | null;
  article_count: number;
  legislative_history: string | null;
  warnings: string[];
}

const regulationPath = (id: string) => `/regulations/${pathSegment(id)}`;

export const regulationHref = (reg: { id: string; title?: string | null }) =>
  regulationPath(reg.title?.trim() || reg.id);

export const regulationsApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<RegulationListItem[]>(`/regulations${qs}`);
  },
  search: (keyword: string, params?: Record<string, string>) => {
    const base: Record<string, string> = { keyword, ...params };
    return get<RegulationSearchResult[]>(
      `/regulations/search?${new URLSearchParams(base).toString()}`,
    );
  },
  get: (id: string) => get<RegulationOut>(regulationPath(id)),
  create: (body: {
    title: string; category: RegulationCategory; content: string; preface?: string; org_id: string;
    amendment_type?: "enact" | "amend" | "abolish";
    amended_articles?: string | null;
    effective_date?: string | null;
    legislative_history?: string | null;
    legal_basis?: string | null;
    proposal_metadata?: string | null;
  }) =>
    post<RegulationOut>("/regulations", body),
  importDocument: async (file: File, body: {
    org_id: string;
    category: RegulationCategory;
    publish_immediately?: boolean;
    change_brief?: string;
  }) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("org_id", body.org_id);
    fd.append("category", body.category);
    fd.append("publish_immediately", String(body.publish_immediately ?? false));
    fd.append("change_brief", body.change_brief ?? "匯入既有現行法規");

    const doFetch = () =>
      fetch(`${BASE}/regulations/import-docx`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      });

    let res = await doFetch();
    if (res.status === 401) {
      const ok = await silentRefresh();
      if (ok) res = await doFetch();
      else {
        if (typeof window !== "undefined" && localStorage.getItem("user_id")) {
          window.location.replace("/login");
        }
        throw new ApiError(401, "登入已過期，請重新登入");
      }
    }

    if (!res.ok) {
      throw new ApiError(res.status, await errorMessageFromResponse(res));
    }
    return res.json() as Promise<RegulationOut>;
  },
  importDocuments: async (files: File[], body: {
    org_id: string;
    category: RegulationCategory;
    publish_immediately?: boolean;
    change_brief?: string;
  }) => {
    const fd = new FormData();
    files.forEach(file => fd.append("files", file));
    fd.append("org_id", body.org_id);
    fd.append("category", body.category);
    fd.append("publish_immediately", String(body.publish_immediately ?? false));
    fd.append("change_brief", body.change_brief ?? "匯入既有現行法規");

    const doFetch = () =>
      fetch(`${BASE}/regulations/import-documents`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      });

    let res = await doFetch();
    if (res.status === 401) {
      const ok = await silentRefresh();
      if (ok) res = await doFetch();
      else {
        if (typeof window !== "undefined" && localStorage.getItem("user_id")) {
          window.location.replace("/login");
        }
        throw new ApiError(401, "登入已過期，請重新登入");
      }
    }

    if (!res.ok) {
      throw new ApiError(res.status, await errorMessageFromResponse(res));
    }
    return res.json() as Promise<RegulationImportItem[]>;
  },
  update: (id: string, body: Partial<{
    title: string; category: RegulationCategory; content: string; preface: string; change_brief: string;
    amendment_type: "enact" | "amend" | "abolish";
    amended_articles: string | null;
    effective_date: string | null;
    legislative_history: string | null;
    legal_basis: string | null;
    proposal_metadata: string | null;
    autosave: boolean;
  }>) =>
    patch<RegulationOut>(regulationPath(id), body),
  publish: (id: string, body: { change_brief: string; is_total_amendment?: boolean; resolution_link?: string }) =>
    post<RegulationOut>(`${regulationPath(id)}/publish`, body),
  archive: (id: string) => post<RegulationOut>(`${regulationPath(id)}/archive`),
  repeal: (id: string, body: { reason: string; replacement_id?: string | null }) =>
    post<RegulationOut>(`${regulationPath(id)}/repeal`, body),
  delete: (id: string) => del<void>(regulationPath(id)),
  // ── 修訂歷程 ──────────────────────────────────────────────────────────────
  listRevisions: (id: string) => get<RegulationRevisionOut[]>(`${regulationPath(id)}/revisions`),
  structureContent: (id: string, body?: { content?: string | null; replace_existing?: boolean }) =>
    post<RegulationOut>(`${regulationPath(id)}/structure-content`, body ?? {}),
  // ── 審議流程 ──────────────────────────────────────────────────────────────
  listWorkflowLogs: (id: string) => get<RegulationWorkflowLogOut[]>(`${regulationPath(id)}/workflow_logs`),
  submitReview: (id: string, note?: string) => post<RegulationOut>(`${regulationPath(id)}/submit`, { note }),
  forkDraft: (id: string) => post<RegulationOut>(`${regulationPath(id)}/fork_draft`, {}),
  scheduleAgenda: (id: string, note?: string, meetingId?: string) =>
    post<RegulationOut>(`${regulationPath(id)}/schedule`, { note, meeting_id: meetingId }),
  councilApprove: (id: string, note?: string, meetingId?: string) =>
    post<RegulationOut>(`${regulationPath(id)}/council_approve`, { note, meeting_id: meetingId }),
  eligibleMeetings: (id: string) =>
    get<{ id: string; title: string; status: string; bill_stage: string | null; starts_at: string | null }[]>(
      `${regulationPath(id)}/eligible-meetings`,
    ),
  presidentPublish: (
    id: string,
    note?: string,
    options?: { serial_template_id?: string | null; manual_serial_number?: string | null },
  ) => post<RegulationOut>(`${regulationPath(id)}/president_publish`, {
    note,
    serial_template_id: options?.serial_template_id ?? null,
    manual_serial_number: options?.manual_serial_number ?? null,
  }),
  rejectRegulation: (id: string, note: string) => post<RegulationOut>(`${regulationPath(id)}/reject`, { note }),
  freeze: (id: string, reason: string, freeze_document_id?: string) =>
    post<RegulationOut>(`${regulationPath(id)}/freeze`, { reason, freeze_document_id: freeze_document_id ?? null }),
  unfreeze: (id: string) => post<RegulationOut>(`${regulationPath(id)}/unfreeze`, {}),
  // ── 條文管理 ──────────────────────────────────────────────────────────────
  listArticles: (id: string, includeDeleted = false) =>
    get<RegulationArticleOut[]>(`${regulationPath(id)}/articles${includeDeleted ? "?include_deleted=true" : ""}`),
  addArticle: (id: string, body: { sort_index: number; order_index?: number; parent_id?: string | null; article_type: string; title?: string; subtitle?: string; legal_number?: string; content?: string }) =>
    post<RegulationArticleOut>(`${regulationPath(id)}/articles`, body),
  updateArticle: (regId: string, articleId: string, body: Partial<{ sort_index: number; order_index: number; parent_id: string | null; article_type: string; title: string; subtitle: string; legal_number: string; content: string; is_deleted: boolean }>) =>
    patch<RegulationArticleOut>(`${regulationPath(regId)}/articles/${pathSegment(articleId)}`, body),
  tree: (id: string) => get<RegulationTreeNodeOut[]>(`${regulationPath(id)}/tree`),
  moveArticle: (regId: string, articleId: string, body: { parent_id: string | null; order_index: number }) =>
    post<RegulationArticleOut>(`${regulationPath(regId)}/articles/${pathSegment(articleId)}/move`, body),
  deleteArticle: (regId: string, articleId: string, hard = false) =>
    del<void>(`${regulationPath(regId)}/articles/${pathSegment(articleId)}${hard ? "?hard=true" : ""}`),
  reorderArticles: (id: string, items: { id: string; sort_index: number }[]) =>
    put<RegulationArticleOut[]>(`${regulationPath(id)}/articles/reorder`, { items }),
  autoRenumber: (id: string, includeSpecialNumber = false) =>
    post<RegulationArticleOut[]>(`${regulationPath(id)}/articles/auto-renumber`, { include_special_number: includeSpecialNumber }),
  amendmentComparison: (id: string) =>
    get<AmendmentComparisonRow[]>(`${regulationPath(id)}/amendment-comparison`),
  exportAmendmentComparisonPdf: async (id: string, body: {
    proposal_title: string;
    rationale?: string | null;
    rows: AmendmentComparisonRow[];
  }): Promise<Blob> => {
    const doFetch = () =>
      fetch(`${BASE}${regulationPath(id)}/amendment-comparison/export.pdf`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders("POST") },
        body: JSON.stringify(body),
      });
    let res = await doFetch();
    if (res.status === 401 && (await silentRefresh())) res = await doFetch();
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.blob();
  },
  referenceWarnings: (id: string) =>
    get<{ source_article_id: string; source_title: string; referenced_legal_number: string; message: string }[]>(`${regulationPath(id)}/reference-warnings`),
  timeMachine: (id: string, asOfIso: string) =>
    get<{ as_of: string; version: number; amended_at: string; content_snapshot: string; tree: RegulationTreeNodeOut[] }>(
      `${regulationPath(id)}/time-machine?${new URLSearchParams({ as_of: asOfIso }).toString()}`
    ),
};
