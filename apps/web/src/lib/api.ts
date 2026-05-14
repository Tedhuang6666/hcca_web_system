import type {
  DocumentOut, DocumentListItem, DocumentCreate,
  DocumentTemplateCreate, DocumentTemplateOut, DocumentTemplateUpdate,
  BatchDocumentOperationOut,
  DocumentApprovalDelegationOut,
  ProductOut, OrderOut, OrderListItem, OrderCreate,
  RegulationOut, RegulationListItem, RegulationCategory,
  RegulationArticleOut, RegulationRevisionOut, RegulationWorkflowLogOut, RegulationTreeNodeOut,
  SerialTemplateOut,
  MealVendorOut, MenuScheduleOut, MenuScheduleListItem, MenuItemOut,
  MealOrderOut, MealOrderListItem, ItemStatOut, PickupListItemOut, VendorManagerOut,
  SurveyOut, SurveyListItem, SurveyResponseOut, SurveyStats,
  AnnouncementOut, AnnouncementListItem, AnnouncementCreate, AnnouncementUpdate, AnnouncementMediaOut,
  AnnouncementStatsOut,
  SavedFilterOut,
  AuditLogOut,
  OrgRead,
  MFASetupOut, MFAStatusOut,
  PetitionCaseListItem, PetitionCaseOut, PetitionCreate, PetitionCreatedOut,
  PetitionStatsOut, PetitionStatus, PetitionTypeOut,
  NotificationPreferences,
  DocumentEfficiencyOut, DeptRankingItem, PendingAlertItem, AnnouncementParticipationItem,
  SurveyParticipationItem,
} from "./types";
import { API_BASE, apiUrl } from "./config";

const BASE = API_BASE;

// ── 核心 fetch 包裝 ────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let refreshPromise: Promise<boolean> | null = null;

export async function silentRefresh(): Promise<boolean> {
  refreshPromise ??= fetch(apiUrl("/auth/refresh"), {
    method: "POST",
    credentials: "include",
  })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length) ?? null;
}

function csrfHeaders(method?: string): Record<string, string> {
  const normalized = (method ?? "GET").toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(normalized)) return {};
  const token = getCookie("csrf_token");
  return token ? { "X-CSRF-Token": decodeURIComponent(token) } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...csrfHeaders(init.method),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, `無法連線至後端 API：${BASE}`);
  }

  // 401 → 嘗試 silent refresh，成功後重試一次
  if (res.status === 401) {
    const ok = await silentRefresh();
    if (ok) {
      let retry: Response;
      try {
        retry = await fetch(`${BASE}${path}`, {
          ...init,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...csrfHeaders(init.method),
          ...init.headers,
        },
      });
      } catch {
        throw new ApiError(0, `無法連線至後端 API：${BASE}`);
      }
      if (retry.ok) {
        if (retry.status === 204) return undefined as T;
        return retry.json();
      }
      let detail = retry.statusText;
      try { detail = (await retry.json()).detail ?? detail; } catch { /* ignore */ }
      throw new ApiError(retry.status, detail);
    }
    // refresh 失敗：
    // - 若本地「看起來已登入」（有 user_id），視為 session 過期 → 清除並導回登入
    // - 若未登入（無 user_id），可能是在存取公開端點 → 不強制導向 /login
    if (typeof window !== "undefined") {
      const hasLocalLogin = Boolean(localStorage.getItem("user_id"));
      if (hasLocalLogin) {
        localStorage.clear();
        window.location.replace("/login");
      }
    }
    throw new ApiError(401, "登入已過期，請重新登入");
  }

  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const get = <T>(p: string) => request<T>(p);
const post = <T>(p: string, body?: unknown) => request<T>(p, { method: "POST", body: JSON.stringify(body) });
const patch = <T>(p: string, body: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(body) });
const put = <T>(p: string, body: unknown) => request<T>(p, { method: "PUT", body: JSON.stringify(body) });
const del = <T>(p: string) => request<T>(p, { method: "DELETE" });

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
  update: (id: string, body: Partial<DocumentCreate> & { change_note?: string }) =>
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
      let detail = res.statusText;
      try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
      throw new ApiError(res.status, detail);
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
};

// ── 商店 ──────────────────────────────────────────────────────────────────────

export const shopApi = {
  listProducts: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<ProductOut[]>(`/shop/products${qs}`);
  },
  getProduct: (id: string) => get<ProductOut>(`/shop/products/${id}`),
  createOrder: (body: OrderCreate) => post<OrderOut>("/shop/orders", body),
  listOrders: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<OrderListItem[]>(`/shop/orders${qs}`);
  },
  getOrder: (id: string) => get<OrderOut>(`/shop/orders/${id}`),
  cancelOrder: (id: string, reason?: string) =>
    post<OrderOut>(`/shop/orders/${id}/cancel`, { reason }),
  downloadReport: (format: "xlsx" | "csv") => {
    return fetch(`${BASE}/shop/reports/orders.${format}`, {
      credentials: "include",
    });
  },
  // 商品管理（shop:manage）
  createProduct: (body: Record<string, unknown>) => post<ProductOut>("/shop/products", body),
  updateProduct: (id: string, body: Record<string, unknown>) => patch<ProductOut>(`/shop/products/${id}`, body),
  activateProduct: (id: string) => post<ProductOut>(`/shop/products/${id}/activate`, {}),
  deactivateProduct: (id: string) => post<ProductOut>(`/shop/products/${id}/deactivate`, {}),
};

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

const pathSegment = (value: string) => {
  try {
    return encodeURIComponent(decodeURIComponent(value));
  } catch {
    return encodeURIComponent(value);
  }
};
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
    return get<RegulationListItem[]>(`/regulations/search?${new URLSearchParams(base).toString()}`);
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
      let detail = res.statusText;
      try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
      throw new ApiError(res.status, detail);
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
      let detail = res.statusText;
      try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
      throw new ApiError(res.status, detail);
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
  // ── 審議流程 ──────────────────────────────────────────────────────────────
  listWorkflowLogs: (id: string) => get<RegulationWorkflowLogOut[]>(`${regulationPath(id)}/workflow_logs`),
  submitReview: (id: string, note?: string) => post<RegulationOut>(`${regulationPath(id)}/submit`, { note }),
  forkDraft: (id: string) => post<RegulationOut>(`${regulationPath(id)}/fork_draft`, {}),
  scheduleAgenda: (id: string, note?: string) => post<RegulationOut>(`${regulationPath(id)}/schedule`, { note }),
  councilApprove: (id: string, note?: string) => post<RegulationOut>(`${regulationPath(id)}/council_approve`, { note }),
  presidentPublish: (id: string, note?: string) => post<RegulationOut>(`${regulationPath(id)}/president_publish`, { note }),
  rejectRegulation: (id: string, note: string) => post<RegulationOut>(`${regulationPath(id)}/reject`, { note }),
  freeze: (id: string, reason: string, freeze_document_id?: string) =>
    post<RegulationOut>(`${regulationPath(id)}/freeze`, { reason, freeze_document_id: freeze_document_id ?? null }),
  unfreeze: (id: string) => post<RegulationOut>(`${regulationPath(id)}/unfreeze`, {}),
  // ── 條文管理 ──────────────────────────────────────────────────────────────
  listArticles: (id: string, includeDeleted = false) =>
    get<RegulationArticleOut[]>(`${regulationPath(id)}/articles${includeDeleted ? "?include_deleted=true" : ""}`),
  addArticle: (id: string, body: { sort_index: number; order_index?: number; parent_id?: string | null; article_type: string; title?: string; subtitle?: string; legal_number?: string; content?: string }) => {
    // 後端已禁止新建舊層級類型：clause/subsection。前端做一次向前相容轉換，避免 422。
    const article_type =
      body.article_type === "clause" ? "article"
        : body.article_type === "subsection" ? "subparagraph"
          : body.article_type;
    return post<RegulationArticleOut>(`${regulationPath(id)}/articles`, { ...body, article_type });
  },
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
    get<{ article_key: string; revised_text: string; current_text: string; note: string }[]>(`${regulationPath(id)}/amendment-comparison`),
  referenceWarnings: (id: string) =>
    get<{ source_article_id: string; source_title: string; referenced_legal_number: string; message: string }[]>(`${regulationPath(id)}/reference-warnings`),
  timeMachine: (id: string, asOfIso: string) =>
    get<{ as_of: string; version: number; amended_at: string; content_snapshot: string; tree: RegulationTreeNodeOut[] }>(
      `${regulationPath(id)}/time-machine?${new URLSearchParams({ as_of: asOfIso }).toString()}`
    ),
};

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

// ── 字號模板 ──────────────────────────────────────────────────────────────────

export const serialTemplatesApi = {
  list: (params?: { org_id?: string; active_only?: boolean }) => {
    const p: Record<string, string> = {};
    if (params?.org_id) p.org_id = params.org_id;
    if (params?.active_only !== undefined) p.active_only = String(params.active_only);
    const qs = Object.keys(p).length ? "?" + new URLSearchParams(p).toString() : "";
    return get<SerialTemplateOut[]>(`/document-serial-templates${qs}`);
  },
  get: (id: string) => get<SerialTemplateOut>(`/document-serial-templates/${id}`),
  create: (body: {
    org_id: string; category_char: string;
    year_mode?: "roc" | "ce"; reset_on_new_year?: boolean; description?: string;
    is_default?: boolean; is_default_president_publish?: boolean;
  }) => post<SerialTemplateOut>("/document-serial-templates", body),
  update: (id: string, body: {
    description?: string | null; is_active?: boolean;
    reset_on_new_year?: boolean; year_mode?: "roc" | "ce";
    is_default?: boolean; is_default_president_publish?: boolean;
  }) => patch<SerialTemplateOut>(`/document-serial-templates/${id}`, body),
  deactivate: (id: string) => del<void>(`/document-serial-templates/${id}`),
};

// ── 使用者 / Auth ──────────────────────────────────────────────────────────────

export type UserSummary = { id: string; display_name: string; email: string };

export const authApi = {
  me: () => get<{
    id: string;
    display_name: string;
    email: string;
    avatar_url?: string | null;
    is_superuser?: boolean;
    permissions: string[];
  }>("/auth/me"),
};

export const mfaApi = {
  status: () => get<MFAStatusOut>("/auth/mfa/status"),
  setup: () => post<MFASetupOut>("/auth/mfa/setup", {}),
  confirm: (code: string) => post<{ message: string }>("/auth/mfa/confirm", { code }),
  verify: (code: string) => post<{ verified: boolean }>("/auth/mfa/verify", { code }),
  verifyLogin: (challenge_token: string, code: string) =>
    post<{ message: string }>("/auth/mfa/login/verify", { challenge_token, code }),
  regenerateBackupCodes: (code: string) =>
    post<{ backup_codes: string[] }>("/auth/mfa/backup-codes/regenerate", { code }),
  disable: (code: string) =>
    request<{ message: string }>("/auth/mfa/disable", {
      method: "DELETE",
      body: JSON.stringify({ code }),
    }),
};

export const usersApi = {
  list: () => get<UserSummary[]>("/users"),
  /** 依關鍵字搜尋使用者（用於下拉選單）*/
  listForSearch: (keyword: string) => {
    const qs = keyword ? `?search=${encodeURIComponent(keyword)}` : "";
    return get<UserSummary[]>(`/users${qs}`);
  },
  me: () => get<import("@/lib/types").UserRead>("/users/me"),
  updateMe: (body: {
    display_name?: string; student_id?: string;
    show_email?: boolean;
  }) => patch<import("@/lib/types").UserRead>("/users/me", body),
  myPositions: (activeOnly = false) =>
    get<import("@/lib/types").UserPositionRead[]>(
      `/user-positions/me?active_only=${activeOnly}`
    ),
};

// ── 組織（公開端點）───────────────────────────────────────────────────────────

export type { OrgRead } from "./types";

export const orgsApi = {
  list: () => get<OrgRead[]>("/orgs"),
  get: (id: string) => get<OrgRead>(`/orgs/${id}`),
  /** 取得組織樹（巢狀結構） */
  tree: () => get<(OrgRead & { children: OrgRead[] })[]>("/orgs/tree"),
  /** 取得當前使用者有 document:create 權限的組織列表（RBAC 過濾） */
  myCreateOrgs: () => get<OrgRead[]>("/orgs/my-create-orgs"),
  /** 取得當前使用者有 regulation:create 權限的組織列表（RBAC 過濾） */
  myRegulationCreateOrgs: () => get<OrgRead[]>("/orgs/my-regulation-create-orgs"),
  /** 取得當前使用者有 serial:create 權限的組織列表（RBAC 過濾） */
  mySerialTemplateOrgs: () => get<OrgRead[]>("/orgs/my-serial-template-orgs"),
  /** 更新組織資訊（需 org:manage 或 admin:all 權限） */
  updateOrg: (id: string, data: {
    prefix?: string | null;
    name?: string;
    description?: string | null;
    parent_id?: string | null;
    note?: string | null;
    remark?: string | null;
    is_active?: boolean;
  }) =>
    patch<OrgRead>(`/orgs/${id}`, data),
};

// ── 管理員 ────────────────────────────────────────────────────────────────────

import type {
  AdminUserDetail, OrgWithPositions, PermissionCodeInfo, PositionSummary,
} from "./types";

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
    position_ids?: string[]; start_date?: string; end_date?: string | null;
    custom_permission_org_id?: string | null;
    custom_permission_codes?: string[];
  }) => post<AdminUserDetail>("/admin/users/pre-register", body),
  updateUser: (id: string, body: { display_name?: string; is_active?: boolean; is_superuser?: boolean }) =>
    patch<AdminUserDetail>(`/admin/users/${id}`, body),
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
  listPositions: () => get<PositionSummary[]>("/admin/positions"),
  createPosition: (body: {
    org_id: string;
    name: string;
    description?: string;
    weight?: number;
    parent_id?: string | null;
    permission_codes?: string[];
  }) =>
    post<PositionSummary>("/admin/positions", body),
  updatePosition: (
    id: string,
    body: { name?: string; description?: string | null; weight?: number; parent_id?: string | null },
  ) => patch<PositionSummary>(`/admin/positions/${id}`, body),
  replacePositionPermissions: (id: string, codes: string[]) =>
    request<PositionSummary>(`/admin/positions/${id}/permissions`, {
      method: "PUT", body: JSON.stringify(codes),
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
  createOrg: (body: { name: string; description?: string; parent_id?: string | null; prefix?: string | null }) =>
    post<OrgRead>("/orgs", body),
  updateOrg: (id: string, body: {
    name?: string;
    description?: string | null;
    parent_id?: string | null;
    prefix?: string | null;
    note?: string | null;
    remark?: string | null;
    is_active?: boolean;
  }) => patch<OrgRead>(`/orgs/${id}`, body),
  deleteOrg: (id: string) => del<void>(`/orgs/${id}`),
  deactivateOrg: (id: string) => post<OrgRead>(`/orgs/${id}/deactivate`, {}),
  activateOrg: (id: string) => post<OrgRead>(`/orgs/${id}/activate`, {}),
};

// ── 稽核日誌 ──────────────────────────────────────────────────────────────────

export const auditLogsApi = {
  list: (params?: {
    entity_type?: string;
    system?: string;
    entity_id?: string;
    actor_id?: string;
    action?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.entity_type) q.set("entity_type", params.entity_type);
    if (params?.system) q.set("system", params.system);
    if (params?.entity_id) q.set("entity_id", params.entity_id);
    if (params?.actor_id) q.set("actor_id", params.actor_id);
    if (params?.action) q.set("action", params.action);
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<AuditLogOut[]>(`/audit-logs${qs ? `?${qs}` : ""}`);
  },
  exportCsvUrl: (params?: {
    entity_type?: string;
    system?: string;
    entity_id?: string;
    actor_id?: string;
    action?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.entity_type) q.set("entity_type", params.entity_type);
    if (params?.system) q.set("system", params.system);
    if (params?.entity_id) q.set("entity_id", params.entity_id);
    if (params?.actor_id) q.set("actor_id", params.actor_id);
    if (params?.action) q.set("action", params.action);
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return `${BASE}/audit-logs/export.csv${qs ? `?${qs}` : ""}`;
  },
};

// ── 站內通知 ──────────────────────────────────────────────────────────────────

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  related_id: string | null;
  created_at: string;
}

export const notificationsApi = {
  list: (
    unread_only = false,
    limit = 50,
    params?: { date_from?: string; date_to?: string; offset?: number },
  ) => {
    const q = new URLSearchParams();
    q.set("unread_only", String(unread_only));
    q.set("limit", String(limit));
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    return get<NotificationItem[]>(`/notifications/inbox?${q}`);
  },
  count: () => get<{ unread: number; total: number }>("/notifications/inbox/count"),
  markRead: (id: string) => patch<NotificationItem>(`/notifications/inbox/${id}/read`, {}),
  markAllRead: () => post<{ marked_read: number }>("/notifications/inbox/read-all"),
  getPreferences: () => get<NotificationPreferences>("/notifications/preferences"),
  updatePreferences: (body: Partial<NotificationPreferences>) =>
    put<NotificationPreferences>("/notifications/preferences", body),
};

// ── 常用篩選（Saved Filters）───────────────────────────────────────────────────

export const savedFiltersApi = {
  list: (scope?: string) => {
    const qs = scope ? `?scope=${encodeURIComponent(scope)}` : "";
    return get<SavedFilterOut[]>(`/saved-filters${qs}`);
  },
  create: (body: { scope: string; name: string; description?: string; params: Record<string, unknown>; share_path?: string }) =>
    post<SavedFilterOut>("/saved-filters", body),
  update: (id: string, body: Partial<{ name: string; description: string; params: Record<string, unknown>; share_path: string }>) =>
    patch<SavedFilterOut>(`/saved-filters/${id}`, body),
  delete: (id: string) => del<void>(`/saved-filters/${id}`),
};

// ── 學餐系統 ──────────────────────────────────────────────────────────────────

export const mealApi = {
  // 商家
  listVendors: (params?: { org_id?: string; active_only?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.active_only !== undefined) q.set("active_only", String(params.active_only));
    return get<MealVendorOut[]>(`/meal/vendors?${q}`);
  },

  // 菜單排程
  listSchedules: (params?: { vendor_id?: string; is_closed?: boolean; date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params?.vendor_id) q.set("vendor_id", params.vendor_id);
    if (params?.is_closed !== undefined) q.set("is_closed", String(params.is_closed));
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    return get<MenuScheduleListItem[]>(`/meal/schedules?${q}`);
  },
  getSchedule: (id: string) => get<MenuScheduleOut>(`/meal/schedules/${id}`),
  createSchedule: (body: {
    vendor_id: string; date: string;
    order_open_time?: string | null; order_deadline: string; note?: string;
  }) => post<MenuScheduleOut>("/meal/schedules", body),
  updateSchedule: (id: string, body: {
    order_open_time?: string | null; order_deadline?: string; note?: string | null;
  }) => patch<MenuScheduleOut>(`/meal/schedules/${id}`, body),
  closeSchedule: (id: string) => post<MenuScheduleOut>(`/meal/schedules/${id}/close`),
  addMenuItem: (scheduleId: string, body: {
    name: string; description?: string; price: number; max_quantity?: number | null;
  }) => post<MenuItemOut>(`/meal/schedules/${scheduleId}/items`, body),
  updateMenuItem: (itemId: string, body: {
    name?: string; description?: string | null; price?: number;
    max_quantity?: number | null; is_available?: boolean;
  }) => patch<MenuItemOut>(`/meal/items/${itemId}`, body),
  deleteMenuItem: (itemId: string) => del<void>(`/meal/items/${itemId}`),

  // 商家管理
  createVendor: (body: { name: string; org_id: string; description?: string; contact_phone?: string; contact_email?: string }) =>
    post<MealVendorOut>("/meal/vendors", body),
  updateVendor: (id: string, body: {
    name?: string; description?: string | null;
    contact_phone?: string | null; contact_email?: string | null; is_active?: boolean;
  }) => patch<MealVendorOut>(`/meal/vendors/${id}`, body),

  // 訂單
  createOrder: (body: { schedule_id: string; items: { menu_item_id: string; quantity: number }[]; notes?: string }) =>
    post<MealOrderOut>("/meal/orders", body),
  listOrders: (params?: { my_only?: boolean; schedule_id?: string; vendor_id?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.my_only !== undefined) q.set("my_only", String(params.my_only));
    if (params?.schedule_id) q.set("schedule_id", params.schedule_id);
    if (params?.vendor_id) q.set("vendor_id", params.vendor_id);
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    return get<MealOrderListItem[]>(`/meal/orders?${q}`);
  },
  getOrder: (id: string) => get<MealOrderOut>(`/meal/orders/${id}`),
  cancelOrder: (id: string, reason?: string) =>
    post<MealOrderOut>(`/meal/orders/${id}/cancel`, { reason }),
  confirmOrder: (id: string) => post<MealOrderOut>(`/meal/orders/${id}/confirm`),
  completeOrder: (id: string) => post<MealOrderOut>(`/meal/orders/${id}/complete`),
  lookupByCode: (code: string) => get<MealOrderOut>(`/meal/orders/lookup?code=${encodeURIComponent(code)}`),
  getScheduleItemStats: (scheduleId: string) => get<ItemStatOut[]>(`/meal/schedules/${scheduleId}/item-stats`),
  getPickupList: (scheduleId: string) => get<PickupListItemOut[]>(`/meal/schedules/${scheduleId}/pickup-list`),
  assignVendorManager: (vendorId: string, email: string) =>
    post<VendorManagerOut>(`/meal/vendors/${vendorId}/managers`, { email }),
  downloadReport: (format: "xlsx" | "csv", params?: { vendor_id?: string; schedule_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.vendor_id) q.set("vendor_id", params.vendor_id);
    if (params?.schedule_id) q.set("schedule_id", params.schedule_id);
    const qs = q.toString() ? `?${q}` : "";
    return fetch(`${BASE}/meal/reports/orders.${format}${qs}`, {
      credentials: "include",
    });
  },
};

// ── 問卷系統 ──────────────────────────────────────────────────────────────────

export const surveysApi = {
  list: (params?: { status?: string; org_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.org_id) q.set("org_id", params.org_id);
    return get<SurveyListItem[]>(`/surveys/?${q}`);
  },
  get: (id: string) => get<SurveyOut>(`/surveys/${pathSegment(id)}`),
  getPublic: (id: string) => get<SurveyOut>(`/surveys/public/${pathSegment(id)}`),
  create: (body: { title: string; description?: string; is_anonymous?: boolean; allow_multiple?: boolean; opens_at?: string; closes_at?: string; org_id: string }) =>
    post<SurveyOut>("/surveys/", body),
  open: (id: string) => post<SurveyOut>(`/surveys/${pathSegment(id)}/open`),
  close: (id: string) => post<SurveyOut>(`/surveys/${pathSegment(id)}/close`),
  addQuestion: (id: string, body: { question_text: string; question_type: string; is_required?: boolean; options?: string[]; min_value?: number; max_value?: number; placeholder?: string; order_index?: number }) =>
    post<{ id: string; question_text: string; question_type: string; options: string[] }>(`/surveys/${pathSegment(id)}/questions`, body),
  deleteQuestion: (questionId: string) => del<void>(`/surveys/questions/${questionId}`),
  submit: (id: string, body: { answers: { question_id: string; answer_text?: string; answer_options?: string[] }[]; anon_token?: string }) =>
    post<SurveyResponseOut>(`/surveys/${pathSegment(id)}/submit`, body),
  stats: (id: string) => get<SurveyStats>(`/surveys/${pathSegment(id)}/stats`),
};

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
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
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

// ── 公文受文者 ─────────────────────────────────────────────────────────────────

export const documentsRecipientsApi = {
  update: (id: string, recipients: { recipient_type: string; name: string; email?: string }[]) =>
    request<void>(`/documents/${id}/recipients`, {
      method: "PUT",
      body: JSON.stringify({ recipients }),
    }),
};

// ── 公告系統 ───────────────────────────────────────────────────────────────────

export const announcementsApi = {
  activeUrgent: () => get<AnnouncementOut | null>("/announcements/active-urgent"),
  list: (params?: { org_id?: string; skip?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.org_id) qs.set("org_id", params.org_id);
    if (params?.skip != null) qs.set("skip", String(params.skip));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return get<AnnouncementListItem[]>(`/announcements${q ? `?${q}` : ""}`);
  },
  listAll: (params?: { org_id?: string; skip?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.org_id) qs.set("org_id", params.org_id);
    if (params?.skip != null) qs.set("skip", String(params.skip));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return get<AnnouncementListItem[]>(`/announcements/admin/all${q ? `?${q}` : ""}`);
  },
  get: (id: string) => get<AnnouncementOut>(`/announcements/${id}`),
  create: (body: AnnouncementCreate) => post<AnnouncementOut>("/announcements", body),
  update: (id: string, body: AnnouncementUpdate) => patch<AnnouncementOut>(`/announcements/${id}`, body),
  publish: (id: string) => post<AnnouncementOut>(`/announcements/${id}/publish`, {}),
  unpublish: (id: string) => post<AnnouncementOut>(`/announcements/${id}/unpublish`, {}),
  setUrgent: (id: string, body: { is_urgent?: boolean; urgent_until?: string | null }) =>
    patch<AnnouncementOut>(`/announcements/${id}/urgent`, body),
  delete: (id: string) => del<void>(`/announcements/${id}`),
  uploadMedia: async (id: string, file: File): Promise<AnnouncementMediaOut> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/announcements/${id}/media`, {
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
      let detail = res.statusText;
      try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
      throw new ApiError(res.status, detail);
    }
    return res.json();
  },
  deleteMedia: (annId: string, mediaId: string) =>
    del<void>(`/announcements/${annId}/media/${mediaId}`),
  getStats: (id: string) => get<AnnouncementStatsOut>(`/announcements/${id}/stats`),
};

export const analyticsApi = {
  documentEfficiency: (params?: { org_id?: string; date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    return get<DocumentEfficiencyOut>(`/analytics/documents/efficiency${q.size ? `?${q}` : ""}`);
  },
  deptRanking: (params?: { date_from?: string; date_to?: string }) => {
    const q = new URLSearchParams();
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    return get<DeptRankingItem[]>(`/analytics/documents/dept-ranking${q.size ? `?${q}` : ""}`);
  },
  pendingAlerts: (threshold_hours = 48) =>
    get<PendingAlertItem[]>(`/analytics/documents/pending-alerts?threshold_hours=${threshold_hours}`),
  announcementParticipation: (params?: {
    org_id?: string; date_from?: string; date_to?: string; limit?: number
  }) => {
    const q = new URLSearchParams();
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    if (params?.limit) q.set("limit", String(params.limit));
    return get<AnnouncementParticipationItem[]>(
      `/analytics/announcements/participation${q.size ? `?${q}` : ""}`
    );
  },
  surveyParticipation: (params?: {
    org_id?: string; date_from?: string; date_to?: string; limit?: number
  }) => {
    const q = new URLSearchParams();
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    if (params?.limit) q.set("limit", String(params.limit));
    return get<SurveyParticipationItem[]>(
      `/analytics/surveys/participation${q.size ? `?${q}` : ""}`
    );
  },
};
