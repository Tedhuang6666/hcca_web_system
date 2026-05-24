import type {
  DocumentOut, DocumentListItem, DocumentCreate,
  DocumentTemplateCreate, DocumentTemplateOut, DocumentTemplateUpdate,
  BatchDocumentOperationOut,
  DocumentApprovalDelegationOut,
  ProductOut, OrderOut, OrderListItem, CartOut, OrderSummaryOut,
  ProductCategoryOut, ProductSeriesOut, ProductVariantGroupOut, ProductVariantOptionOut,
  CatalogCategoryOut,
  SchoolClassOut, SchoolClassListItem, SchoolClassBulkCreate, SchoolClassBulkCreateOut,
  ClassMemberOut, ClassStudentRangeOut, ClassCadreOut, ClassManualMemberOut,
  ClassMembershipOut, ClassRoleOut,
  RegulationOut, RegulationListItem, RegulationCategory, RegulationSearchResult,
  RegulationArticleOut, RegulationRevisionOut, RegulationWorkflowLogOut, RegulationTreeNodeOut,
  SerialTemplateOut,
  MeetingListItem, MeetingOut, MeetingScreenOut, MeetingMinutesOut, MeetingWorkspaceOut,
  MeetingEventOut,
  MeetingJoinOut, MeetingScreenStateOut, MeetingArtifactLinkOut,
  MeetingAttendanceSourcePreviewOut, MeetingAttendanceSourceOut,
  MeetingMotionOut, MeetingDecisionOut,
  MeetingAgendaAttachmentOut, MeetingAgendaItemOut, MeetingAttendanceOut, MeetingVoteOut, MeetingBallotOut,
  MeetingRequestOut, MeetingBillStage, MeetingRegulationBrief,
  AgendaItemType, AttendanceRole, AttendanceStatus, VoteVisibility, BallotChoice,
  MeetingRequestStatus, MeetingRequestType, AttendanceSourceType, MeetingArtifactType,
  MeetingMotionType, MeetingMotionStatus, MeetingDecisionStatus, MeetingScreenReadingMode,
  MealAvailabilityOut, MealClassPickupCodeOut, MealPickupLookupOut,
  MealProductOut, MealVendorApplicationOut, MealVendorOut,
  MenuScheduleOut, MenuScheduleListItem, MenuItemOut,
  MealOrderOut, MealOrderListItem, ItemStatOut, PickupListItemOut, VendorManagerOut,
  SurveyOut, SurveyListItem, SurveyQuestionOut, SurveyResponseOut, SurveyResponseAdminItem, SurveyStats,
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
  EmailComposePayload, EmailMessageCreate, EmailMessageOut, EmailMessageDetailOut,
  RecipientSelector, RecipientPreviewOut, EmailPosition,
  PartnerBusinessCreate, PartnerBusinessListItem, PartnerBusinessOut, PartnerBusinessUpdate,
  PartnerLocationCreate, PartnerLocationOut, PartnerLocationUpdate,
  PartnerMapItem, PartnerOfferCreate, PartnerOfferOut, PartnerOfferUpdate,
  PartnerRankingItem, PartnerRatingCreate, PartnerRatingOut,
  PartnerSubmissionCreate, PartnerSubmissionOut,
  PartnerTagCreate, PartnerTagOut, PartnerTagUpdate,
} from "./types";
import { API_BASE, apiUrl } from "./config";

const BASE = API_BASE;

// ── 核心 fetch 包裝 ────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function withFallback<T>(
  promise: Promise<T>,
  fallback: T,
  onError?: (error: unknown) => void,
): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    onError?.(error);
    return fallback;
  }
}

let refreshPromise: Promise<boolean> | null = null;

function formatErrorDetail(detail: unknown, fallback: string): string {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return String(item);
        const record = item as Record<string, unknown>;
        const msg = typeof record.msg === "string" ? record.msg : undefined;
        const loc = Array.isArray(record.loc)
          ? record.loc.filter((part) => part !== "body").join(".")
          : undefined;
        if (msg && loc) return `${loc}: ${msg}`;
        if (msg) return msg;
        return JSON.stringify(record);
      })
      .filter(Boolean);
    return messages.length ? messages.join("；") : fallback;
  }
  if (typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    for (const key of ["message", "msg", "error", "detail"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    try {
      return JSON.stringify(record);
    } catch {
      return fallback;
    }
  }
  return String(detail);
}

async function errorMessageFromResponse(res: Response): Promise<string> {
  let detail: unknown = res.statusText;
  try {
    const payload: unknown = await res.json();
    detail =
      payload && typeof payload === "object" && "detail" in payload
        ? (payload as { detail?: unknown }).detail
        : payload;
  } catch {
    // ignore non-JSON error bodies
  }
  return formatErrorDetail(detail, res.statusText || "請求失敗");
}

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
      throw new ApiError(retry.status, await errorMessageFromResponse(retry));
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
    throw new ApiError(res.status, await errorMessageFromResponse(res));
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
};

// ── 商店 ──────────────────────────────────────────────────────────────────────

export const shopApi = {
  // 瀏覽
  catalog: (orgId?: string) =>
    get<CatalogCategoryOut[]>(`/shop/catalog${orgId ? `?org_id=${orgId}` : ""}`),
  listProducts: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<ProductOut[]>(`/shop/products${qs}`);
  },
  getProduct: (id: string) => get<ProductOut>(`/shop/products/${id}`),

  // 購物車
  getCart: () => get<CartOut>("/shop/cart"),
  addCartItem: (body: { product_id: string; quantity: number; option_ids: string[] }) =>
    post<CartOut>("/shop/cart/items", body),
  updateCartItem: (itemId: string, quantity: number) =>
    patch<CartOut>(`/shop/cart/items/${itemId}`, { quantity }),
  removeCartItem: (itemId: string) => del<CartOut>(`/shop/cart/items/${itemId}`),
  clearCart: () => del<CartOut>("/shop/cart"),
  checkout: (notes?: string) => post<OrderOut[]>("/shop/cart/checkout", { notes }),

  // 訂單
  listOrders: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<OrderListItem[]>(`/shop/orders${qs}`);
  },
  listClassOrders: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<OrderListItem[]>(`/shop/orders/class${qs}`);
  },
  orderSummary: (params: {
    group_by: "class" | "grade" | "user";
    org_id?: string;
    product_id?: string;
    grade?: string;
    class_id?: string;
    user_id?: string;
    status?: string;
    is_paid?: string;
    date_from?: string;
    date_to?: string;
  }) => {
    const p = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) p.set(key, value);
    });
    return get<OrderSummaryOut>(`/shop/orders/summary?${p.toString()}`);
  },
  getOrder: (id: string) => get<OrderOut>(`/shop/orders/${id}`),
  cancelOrder: (id: string, reason?: string) =>
    post<OrderOut>(`/shop/orders/${id}/cancel`, { reason }),
  setOrderPaid: (id: string, isPaid: boolean) =>
    patch<OrderOut>(`/shop/orders/${id}/payment`, { is_paid: isPaid }),
  downloadReport: (format: "xlsx" | "csv") =>
    fetch(`${BASE}/shop/reports/orders.${format}`, { credentials: "include" }),

  // 分類管理（shop:manage）
  listCategories: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<ProductCategoryOut[]>(`/shop/categories${qs}`);
  },
  createCategory: (body: Record<string, unknown>) =>
    post<ProductCategoryOut>("/shop/categories", body),
  updateCategory: (id: string, body: Record<string, unknown>) =>
    patch<ProductCategoryOut>(`/shop/categories/${id}`, body),
  deleteCategory: (id: string) => del<void>(`/shop/categories/${id}`),
  listSeries: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<ProductSeriesOut[]>(`/shop/series${qs}`);
  },
  createSeries: (body: Record<string, unknown>) =>
    post<ProductSeriesOut>("/shop/series", body),
  updateSeries: (id: string, body: Record<string, unknown>) =>
    patch<ProductSeriesOut>(`/shop/series/${id}`, body),
  deleteSeries: (id: string) => del<void>(`/shop/series/${id}`),

  // 商品管理
  createProduct: (body: Record<string, unknown>) => post<ProductOut>("/shop/products", body),
  updateProduct: (id: string, body: Record<string, unknown>) =>
    patch<ProductOut>(`/shop/products/${id}`, body),
  activateProduct: (id: string) => post<ProductOut>(`/shop/products/${id}/activate`, {}),
  deactivateProduct: (id: string) => post<ProductOut>(`/shop/products/${id}/deactivate`, {}),

  // 變體管理
  addVariantGroup: (productId: string, body: Record<string, unknown>) =>
    post<ProductVariantGroupOut>(`/shop/products/${productId}/variant-groups`, body),
  updateVariantGroup: (groupId: string, body: Record<string, unknown>) =>
    patch<ProductVariantGroupOut>(`/shop/variant-groups/${groupId}`, body),
  deleteVariantGroup: (groupId: string) => del<void>(`/shop/variant-groups/${groupId}`),
  addVariantOption: (groupId: string, body: Record<string, unknown>) =>
    post<ProductVariantOptionOut>(`/shop/variant-groups/${groupId}/options`, body),
  updateVariantOption: (optionId: string, body: Record<string, unknown>) =>
    patch<ProductVariantOptionOut>(`/shop/variant-options/${optionId}`, body),
  deleteVariantOption: (optionId: string) => del<void>(`/shop/variant-options/${optionId}`),

  // 圖片上傳
  uploadImage: async (file: File): Promise<{ url: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/shop/images`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      });
    let res = await doFetch();
    if (res.status === 401 && (await silentRefresh())) res = await doFetch();
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.json();
  },
};

// ── 特約地圖 ──────────────────────────────────────────────────────────────────

export const partnerMapApi = {
  list: (params?: {
    tag_ids?: string[];
    keyword?: string;
    min_lat?: string;
    max_lat?: string;
    min_lng?: string;
    max_lng?: string;
    has_active_offer?: boolean;
    limit?: string;
    offset?: string;
  }) => {
    const p = new URLSearchParams();
    params?.tag_ids?.forEach((id) => p.append("tag_ids", id));
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (key === "tag_ids" || value === undefined || value === null || value === "") return;
      p.set(key, String(value));
    });
    return get<PartnerMapItem[]>(`/partner-map${p.size ? `?${p.toString()}` : ""}`);
  },
  tags: () => get<PartnerTagOut[]>("/partner-map/tags"),
  rankings: (limit = 10) => get<PartnerRankingItem[]>(`/partner-map/rankings?limit=${limit}`),
  getBusiness: (id: string) => get<PartnerBusinessOut>(`/partner-map/businesses/${id}`),
  recordClick: (id: string) => post<PartnerBusinessOut>(`/partner-map/businesses/${id}/click`, {}),
  checkIn: (id: string) => post<PartnerBusinessOut>(`/partner-map/businesses/${id}/check-in`, {}),
  listRatings: (id: string) => get<PartnerRatingOut[]>(`/partner-map/businesses/${id}/ratings`),
  rateBusiness: (id: string, body: PartnerRatingCreate) =>
    post<PartnerRatingOut>(`/partner-map/businesses/${id}/ratings`, body),
  submitBusiness: (body: PartnerSubmissionCreate) =>
    post<PartnerSubmissionOut>("/partner-map/submissions", body),

  adminListBusinesses: (params?: { include_inactive?: boolean; limit?: string; offset?: string }) => {
    const p = new URLSearchParams();
    if (params?.include_inactive !== undefined) p.set("include_inactive", String(params.include_inactive));
    if (params?.limit) p.set("limit", params.limit);
    if (params?.offset) p.set("offset", params.offset);
    return get<PartnerBusinessListItem[]>(`/partner-map/admin/businesses${p.size ? `?${p}` : ""}`);
  },
  adminGetBusiness: (id: string) => get<PartnerBusinessOut>(`/partner-map/admin/businesses/${id}`),
  createBusiness: (body: PartnerBusinessCreate) =>
    post<PartnerBusinessOut>("/partner-map/admin/businesses", body),
  updateBusiness: (id: string, body: PartnerBusinessUpdate) =>
    patch<PartnerBusinessOut>(`/partner-map/admin/businesses/${id}`, body),
  deleteBusiness: (id: string) => del<void>(`/partner-map/admin/businesses/${id}`),
  adminSubmissions: (params?: { status?: string }) => {
    const qs = params?.status ? `?${new URLSearchParams({ status: params.status }).toString()}` : "";
    return get<PartnerSubmissionOut[]>(`/partner-map/admin/submissions${qs}`);
  },
  reviewSubmission: (id: string, body: { status: string; review_note?: string | null; business_id?: string | null }) =>
    patch<PartnerSubmissionOut>(`/partner-map/admin/submissions/${id}`, body),

  adminTags: () => get<PartnerTagOut[]>("/partner-map/admin/tags"),
  createTag: (body: PartnerTagCreate) => post<PartnerTagOut>("/partner-map/admin/tags", body),
  updateTag: (id: string, body: PartnerTagUpdate) =>
    patch<PartnerTagOut>(`/partner-map/admin/tags/${id}`, body),
  deleteTag: (id: string) => del<void>(`/partner-map/admin/tags/${id}`),

  createLocation: (businessId: string, body: PartnerLocationCreate) =>
    post<PartnerLocationOut>(`/partner-map/admin/businesses/${businessId}/locations`, body),
  updateLocation: (id: string, body: PartnerLocationUpdate) =>
    patch<PartnerLocationOut>(`/partner-map/admin/locations/${id}`, body),
  deleteLocation: (id: string) => del<void>(`/partner-map/admin/locations/${id}`),

  createOffer: (businessId: string, body: PartnerOfferCreate) =>
    post<PartnerOfferOut>(`/partner-map/admin/businesses/${businessId}/offers`, body),
  updateOffer: (id: string, body: PartnerOfferUpdate) =>
    patch<PartnerOfferOut>(`/partner-map/admin/offers/${id}`, body),
  deleteOffer: (id: string) => del<void>(`/partner-map/admin/offers/${id}`),
};

// ── 班級 ──────────────────────────────────────────────────────────────────────

export const classApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<SchoolClassListItem[]>(`/classes${qs}`);
  },
  get: (id: string) => get<SchoolClassOut>(`/classes/${id}`),
  myClass: () => get<SchoolClassListItem | null>("/classes/me"),
  create: (body: Record<string, unknown>) => post<SchoolClassOut>("/classes", body),
  bulkCreate: (body: SchoolClassBulkCreate) => post<SchoolClassBulkCreateOut>("/classes/bulk", body),
  update: (id: string, body: Record<string, unknown>) =>
    patch<SchoolClassOut>(`/classes/${id}`, body),
  remove: (id: string) => del<void>(`/classes/${id}`),
  members: (id: string) => get<ClassMemberOut[]>(`/classes/${id}/members`),
  memberships: (id: string) => get<ClassMembershipOut[]>(`/classes/${id}/memberships`),
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
  scheduleAgenda: (id: string, note?: string, meetingId?: string) =>
    post<RegulationOut>(`${regulationPath(id)}/schedule`, { note, meeting_id: meetingId }),
  councilApprove: (id: string, note?: string, meetingId?: string) =>
    post<RegulationOut>(`${regulationPath(id)}/council_approve`, { note, meeting_id: meetingId }),
  eligibleMeetings: (id: string) =>
    get<{ id: string; title: string; status: string; bill_stage: string | null; starts_at: string | null }[]>(
      `${regulationPath(id)}/eligible-meetings`,
    ),
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
    allow_external_login?: boolean;
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
  myPositions: (activeOnly = false) =>
    get<import("@/lib/types").UserPositionRead[]>(
      `/user-positions/me?active_only=${activeOnly}`
    ),
};

// ── 組織（公開端點）───────────────────────────────────────────────────────────

export type { OrgRead } from "./types";

export const orgsApi = {
  list: (params?: { active_only?: boolean }) => {
    const qs = params?.active_only ? "?active_only=true" : "";
    return get<OrgRead[]>(`/orgs${qs}`);
  },
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
    allow_external_login?: boolean;
    position_ids?: string[]; start_date?: string; end_date?: string | null;
    custom_permission_org_id?: string | null;
    custom_permission_codes?: string[];
  }) => post<AdminUserDetail>("/admin/users/pre-register", body),
  updateUser: (id: string, body: {
    display_name?: string;
    is_active?: boolean;
    allow_external_login?: boolean;
    is_superuser?: boolean;
  }) =>
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
  createOrg: (body: {
    name: string;
    description?: string;
    parent_id?: string | null;
    prefix?: string | null;
    bill_stage?: MeetingBillStage | null;
  }) => post<OrgRead>("/orgs", body),
  updateOrg: (id: string, body: {
    name?: string;
    description?: string | null;
    parent_id?: string | null;
    prefix?: string | null;
    bill_stage?: MeetingBillStage | null;
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
  unsubscribe: (token: string) =>
    post<{ status: string; type: string; message: string }>(
      "/notifications/unsubscribe",
      { token },
    ),
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
  createVendor: (body: {
    name: string; org_id?: string | null; description?: string | null;
    contact_phone?: string | null; contact_email?: string | null; manager_email?: string | null;
    status?: string | null;
  }) =>
    post<MealVendorOut>("/meal/vendors", body),
  updateVendor: (id: string, body: {
    name?: string; description?: string | null;
    contact_phone?: string | null; contact_email?: string | null; is_active?: boolean;
    status?: string; review_note?: string | null;
  }) => patch<MealVendorOut>(`/meal/vendors/${id}`, body),
  createVendorApplication: (body: {
    name: string; org_id?: string | null; description?: string | null;
    contact_name?: string | null; contact_phone?: string | null; contact_email?: string | null;
  }) => post<MealVendorApplicationOut>("/meal/vendor-applications", body),
  listVendorApplications: (params?: { status?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    return get<MealVendorApplicationOut[]>(`/meal/vendor-applications?${q}`);
  },
  reviewVendorApplication: (id: string, body: { approved: boolean; review_note?: string | null }) =>
    post<MealVendorApplicationOut>(`/meal/vendor-applications/${id}/review`, body),
  listVendorManagers: (vendorId: string) =>
    get<VendorManagerOut[]>(`/meal/vendors/${vendorId}/managers`),
  removeVendorManager: (vendorId: string, userId: string) =>
    del<void>(`/meal/vendors/${vendorId}/managers/${userId}`),
  uploadImage: async (file: File): Promise<{ url: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/meal/images`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      });
    let res = await doFetch();
    if (res.status === 401 && (await silentRefresh())) res = await doFetch();
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.json();
  },
  listProducts: (params?: { vendor_id?: string; active_only?: boolean; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.vendor_id) q.set("vendor_id", params.vendor_id);
    if (params?.active_only !== undefined) q.set("active_only", String(params.active_only));
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    return get<MealProductOut[]>(`/meal/products?${q}`);
  },
  createProduct: (body: {
    vendor_id: string; name: string; description?: string | null; category?: string | null;
    image_url?: string | null; price: number; default_max_quantity?: number | null;
  }) => post<MealProductOut>("/meal/products", body),
  updateProduct: (id: string, body: Partial<{
    name: string; description: string | null; category: string | null; image_url: string | null;
    price: number; default_max_quantity: number | null; is_active: boolean;
  }>) => patch<MealProductOut>(`/meal/products/${id}`, body),
  listAvailabilities: (params?: {
    vendor_id?: string; date_from?: string; date_to?: string; active_only?: boolean; limit?: number; offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.vendor_id) q.set("vendor_id", params.vendor_id);
    if (params?.date_from) q.set("date_from", params.date_from);
    if (params?.date_to) q.set("date_to", params.date_to);
    if (params?.active_only !== undefined) q.set("active_only", String(params.active_only));
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    return get<MealAvailabilityOut[]>(`/meal/availabilities?${q}`);
  },
  createAvailability: (body: {
    product_id: string; service_date: string; sale_start?: string | null; sale_end?: string | null;
    price?: number | null; max_quantity?: number | null; note?: string | null;
    pickup_slots?: {
      label: string; sort_order?: number; pickup_start: string; pickup_end: string;
      order_deadline: string; capacity?: number | null;
    }[];
  }) => post<MealAvailabilityOut>("/meal/availabilities", body),
  bulkCreateWeeklyAvailabilities: (body: {
    product_ids: string[]; date_from: string; date_to: string; weekdays: number[];
    sale_start_time?: string | null; sale_end_time?: string | null;
    pickup_slots?: {
      label: string; sort_order?: number; pickup_start: string; pickup_end: string;
      order_deadline: string; capacity?: number | null;
    }[];
  }) => post<MealAvailabilityOut[]>("/meal/availabilities/weekly", body),

  // 訂單
  createOrder: (body: {
    schedule_id?: string | null; pickup_slot_id?: string | null;
    items: { menu_item_id?: string | null; availability_id?: string | null; quantity: number }[];
    notes?: string;
  }) =>
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
  setOrderPaid: (id: string, isPaid: boolean) =>
    post<MealOrderOut>(`/meal/orders/${id}/payment?is_paid=${String(isPaid)}`),
  listClassOrders: (params?: { vendor_id?: string; pickup_slot_id?: string; is_paid?: boolean; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.vendor_id) q.set("vendor_id", params.vendor_id);
    if (params?.pickup_slot_id) q.set("pickup_slot_id", params.pickup_slot_id);
    if (params?.is_paid !== undefined) q.set("is_paid", String(params.is_paid));
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    return get<MealOrderListItem[]>(`/meal/orders/class?${q}`);
  },
  getClassPickupCode: (params: { class_id: string; vendor_id: string; pickup_slot_id: string }) => {
    const q = new URLSearchParams(params);
    return post<MealClassPickupCodeOut>(`/meal/orders/class-pickup-code?${q}`);
  },
  lookupByCode: (code: string) => get<MealOrderOut>(`/meal/orders/lookup?code=${encodeURIComponent(code)}`),
  pickupLookup: (code: string, redeem = true) =>
    post<MealPickupLookupOut>(`/meal/pickup/lookup?code=${encodeURIComponent(code)}&redeem=${String(redeem)}`),
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

export type SurveyQuestionBody = {
  question_text?: string;
  question_type?: string;
  is_required?: boolean;
  options?: string[];
  min_value?: number;
  max_value?: number;
  placeholder?: string;
  image_url?: string;
  min_length?: number;
  max_length?: number;
  validation_rule?: string;
  min_label?: string;
  max_label?: string;
  condition?: { rules: { question_id: string; operator: string; value: string; connector: string }[] } | null;
  order_index?: number;
};

export const surveysApi = {
  list: (params?: { status?: string; org_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.org_id) q.set("org_id", params.org_id);
    const qs = q.toString();
    return get<SurveyListItem[]>(`/surveys${qs ? `?${qs}` : ""}`);
  },
  /** 公開問卷列表（未登入可用，僅回傳 is_public 且開放/已截止的問卷） */
  listPublic: (params?: { status?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return get<SurveyListItem[]>(`/surveys/public${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => get<SurveyOut>(`/surveys/${pathSegment(id)}`),
  getPublic: (id: string) => get<SurveyOut>(`/surveys/public/${pathSegment(id)}`),
  create: (body: { title: string; description?: string; is_anonymous?: boolean; allow_multiple?: boolean; opens_at?: string; closes_at?: string; org_id: string; is_public?: boolean; allowed_org_ids?: string[]; allowed_user_ids?: string[]; allowed_domains?: string[] }) =>
    post<SurveyOut>("/surveys", body),
  update: (id: string, body: { title?: string; description?: string; opens_at?: string; closes_at?: string; is_public?: boolean; allowed_org_ids?: string[]; allowed_user_ids?: string[]; allowed_domains?: string[] }) =>
    patch<SurveyOut>(`/surveys/${pathSegment(id)}`, body),
  open: (id: string) => post<SurveyOut>(`/surveys/${pathSegment(id)}/open`),
  close: (id: string) => post<SurveyOut>(`/surveys/${pathSegment(id)}/close`),
  addQuestion: (id: string, body: SurveyQuestionBody & { question_text: string; question_type: string }) =>
    post<SurveyQuestionOut>(`/surveys/${pathSegment(id)}/questions`, body),
  updateQuestion: (questionId: string, body: SurveyQuestionBody) =>
    patch<SurveyQuestionOut>(`/surveys/questions/${questionId}`, body),
  deleteQuestion: (questionId: string) => del<void>(`/surveys/questions/${questionId}`),
  submit: (id: string, body: { answers: { question_id: string; answer_text?: string; answer_options?: string[] }[]; anon_token?: string; email_copy?: boolean }) =>
    post<SurveyResponseOut>(`/surveys/${pathSegment(id)}/submit`, body),
  stats: (id: string) => get<SurveyStats>(`/surveys/${pathSegment(id)}/stats`),
  responses: (id: string) =>
    get<SurveyResponseAdminItem[]>(`/surveys/${pathSegment(id)}/responses`),
  uploadImage: async (file: File): Promise<{ url: string; filename: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/surveys/images`, {
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
  exportSpreadsheet: async (id: string): Promise<Blob> => {
    const doFetch = () =>
      fetch(`${BASE}/surveys/${pathSegment(id)}/export`, { credentials: "include" });
    let res = await doFetch();
    if (res.status === 401) {
      const ok = await silentRefresh();
      if (ok) res = await doFetch();
    }
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.blob();
  },
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
      throw new ApiError(res.status, await errorMessageFromResponse(res));
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

// ── 議事系統 ──────────────────────────────────────────────────────────────────

export const meetingsApi = {
  workspace: () => get<MeetingWorkspaceOut>("/meetings/workspace"),
  list: (params?: { org_id?: string; status?: string; invited_only?: boolean; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.status) q.set("status", params.status);
    if (params?.invited_only) q.set("invited_only", "true");
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    return get<MeetingListItem[]>(`/meetings${q.size ? `?${q}` : ""}`);
  },
  get: (id: string) => get<MeetingOut>(`/meetings/${id}`),
  join: (token: string) => get<MeetingJoinOut>(`/meetings/join/${encodeURIComponent(token)}`),
  create: (body: {
    title: string;
    org_id: string;
    description?: string | null;
    location?: string | null;
    chair_name?: string | null;
    starts_at?: string | null;
    ends_at?: string | null;
    expected_voters?: number;
    quorum_count?: number;
    default_pass_threshold?: number;
    bill_stage?: MeetingBillStage | null;
  }) => post<MeetingOut>("/meetings", body),
  update: (id: string, body: Partial<{
    title: string;
    description: string | null;
    location: string | null;
    chair_name: string | null;
    starts_at: string | null;
    ends_at: string | null;
    expected_voters: number;
    quorum_count: number;
    default_pass_threshold: number;
    bill_stage: MeetingBillStage | null;
    current_agenda_item_id: string | null;
    screen_focus_title: string | null;
    screen_focus_body: string | null;
  }>) => patch<MeetingOut>(`/meetings/${id}`, body),
  start: (id: string) => post<MeetingOut>(`/meetings/${id}/start`),
  pause: (id: string) => post<MeetingOut>(`/meetings/${id}/pause`),
  close: (id: string) => post<MeetingOut>(`/meetings/${id}/close`),
  addAgendaItem: (id: string, body: {
    title: string;
    description?: string | null;
    item_type?: AgendaItemType;
    order_index?: number;
    regulation_id?: string | null;
    document_id?: string | null;
    notes?: string | null;
    resolution?: string | null;
  }) => post<MeetingAgendaItemOut>(`/meetings/${id}/agenda-items`, body),
  updateAgendaItem: (id: string, itemId: string, body: Partial<{
    title: string;
    description: string | null;
    item_type: AgendaItemType;
    order_index: number;
    regulation_id: string | null;
    document_id: string | null;
    notes: string | null;
    resolution: string | null;
  }>) => patch<MeetingAgendaItemOut>(`/meetings/${id}/agenda-items/${itemId}`, body),
  reorderAgendaItems: (id: string, orderedIds: string[]) =>
    patch<MeetingAgendaItemOut[]>(`/meetings/${id}/agenda-items/reorder`, orderedIds),
  uploadAgendaAttachment: async (
    id: string,
    itemId: string,
    file: File,
  ): Promise<MeetingAgendaAttachmentOut> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/meetings/${id}/agenda-items/${itemId}/attachments`, {
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
  addAgendaAttachmentLink: (
    id: string,
    itemId: string,
    body: { url: string; display_text?: string | null },
  ) =>
    post<MeetingAgendaAttachmentOut>(
      `/meetings/${id}/agenda-items/${itemId}/attachments/link`,
      body,
    ),
  deleteAgendaAttachment: (id: string, itemId: string, attachmentId: string) =>
    del<void>(`/meetings/${id}/agenda-items/${itemId}/attachments/${attachmentId}`),
  agendaAttachmentDownloadUrl: (id: string, itemId: string, attachmentId: string) =>
    `${BASE}/meetings/${id}/agenda-items/${itemId}/attachments/${attachmentId}/download`,
  addArtifactLink: (id: string, itemId: string, body: {
    artifact_type: MeetingArtifactType;
    object_id?: string | null;
    title: string;
    url?: string | null;
    summary?: string | null;
  }) => post<MeetingArtifactLinkOut>(`/meetings/${id}/agenda-items/${itemId}/artifact-links`, body),
  updateArtifactLink: (id: string, itemId: string, linkId: string, body: Partial<{
    title: string;
    url: string | null;
    summary: string | null;
  }>) => patch<MeetingArtifactLinkOut>(
    `/meetings/${id}/agenda-items/${itemId}/artifact-links/${linkId}`,
    body,
  ),
  deleteArtifactLink: (id: string, itemId: string, linkId: string) =>
    del<void>(`/meetings/${id}/agenda-items/${itemId}/artifact-links/${linkId}`),
  deleteAgendaItem: (id: string, itemId: string) =>
    del<void>(`/meetings/${id}/agenda-items/${itemId}`),
  confirm: (
    id: string,
    body?: { notice_serial_template_id?: string | null; notice_serial_number?: string | null },
  ) => post<MeetingOut>(`/meetings/${id}/confirm`, body ?? {}),
  proposableRegulations: (id: string) =>
    get<MeetingRegulationBrief[]>(`/meetings/${id}/proposable-regulations`),
  syncProposals: (id: string) =>
    post<MeetingOut>(`/meetings/${id}/agenda-items/sync-proposals`),
  advanceAgendaRegulation: (id: string, itemId: string) =>
    post<MeetingAgendaItemOut>(`/meetings/${id}/agenda-items/${itemId}/advance-regulation`),
  checkIn: (id: string, token?: string) =>
    post<MeetingAttendanceOut>(
      `/meetings/${id}/check-in${token ? `?token=${encodeURIComponent(token)}` : ""}`,
    ),
  resolveAttendanceSource: (id: string, body: {
    source_type: AttendanceSourceType;
    source_id?: string | null;
    user_ids?: string[];
    role?: AttendanceRole;
    is_voting_eligible?: boolean;
  }) => post<MeetingAttendanceSourcePreviewOut>(`/meetings/${id}/attendance/sources/resolve`, body),
  importAttendanceSource: (id: string, body: {
    source_type: AttendanceSourceType;
    source_id?: string | null;
    user_ids?: string[];
    role?: AttendanceRole;
    is_voting_eligible?: boolean;
    label?: string | null;
  }) => post<MeetingAttendanceSourceOut>(`/meetings/${id}/attendance/sources`, body),
  upsertAttendance: (id: string, body: {
    user_id: string;
    role?: AttendanceRole;
    status?: AttendanceStatus;
    is_voting_eligible?: boolean;
    proxy_for_user_id?: string | null;
    note?: string | null;
  }) => post<MeetingAttendanceOut>(`/meetings/${id}/attendance`, body),
  updateAttendance: (id: string, attendanceId: string, body: Partial<{
    role: AttendanceRole;
    status: AttendanceStatus;
    is_voting_eligible: boolean;
    proxy_for_user_id: string | null;
    note: string | null;
  }>) => patch<MeetingAttendanceOut>(`/meetings/${id}/attendance/${attendanceId}`, body),
  createVote: (id: string, body: {
    title: string;
    description?: string | null;
    agenda_item_id?: string | null;
    visibility?: VoteVisibility;
    pass_threshold?: number;
  }) => post<MeetingVoteOut>(`/meetings/${id}/votes`, body),
  updateVote: (id: string, voteId: string, body: Partial<{
    title: string;
    description: string | null;
    visibility: VoteVisibility;
    pass_threshold: number;
    result_note: string | null;
  }>) => patch<MeetingVoteOut>(`/meetings/${id}/votes/${voteId}`, body),
  createMotion: (id: string, body: {
    agenda_item_id?: string | null;
    proposer_id?: string | null;
    motion_type?: MeetingMotionType;
    title: string;
    content?: string | null;
    vote_id?: string | null;
  }) => post<MeetingMotionOut>(`/meetings/${id}/motions`, body),
  updateMotion: (id: string, motionId: string, body: Partial<{
    agenda_item_id: string | null;
    proposer_id: string | null;
    motion_type: MeetingMotionType;
    title: string;
    content: string | null;
    status: MeetingMotionStatus;
    vote_id: string | null;
  }>) => patch<MeetingMotionOut>(`/meetings/${id}/motions/${motionId}`, body),
  createDecision: (id: string, body: {
    agenda_item_id: string;
    motion_id?: string | null;
    vote_id?: string | null;
    title: string;
    content: string;
    status?: MeetingDecisionStatus;
    regulation_transition_to?: string | null;
  }) => post<MeetingDecisionOut>(`/meetings/${id}/decisions`, body),
  updateDecision: (id: string, decisionId: string, body: Partial<{
    motion_id: string | null;
    vote_id: string | null;
    title: string;
    content: string;
    status: MeetingDecisionStatus;
    regulation_transition_to: string | null;
  }>) => patch<MeetingDecisionOut>(`/meetings/${id}/decisions/${decisionId}`, body),
  openVote: (id: string, voteId: string) =>
    post<MeetingVoteOut>(`/meetings/${id}/votes/${voteId}/open`),
  closeVote: (id: string, voteId: string) =>
    post<MeetingVoteOut>(`/meetings/${id}/votes/${voteId}/close`),
  castBallot: (id: string, voteId: string, choice: BallotChoice) =>
    post<MeetingBallotOut>(`/meetings/${id}/votes/${voteId}/ballot`, { choice }),
  createRequest: (id: string, body: {
    request_type: MeetingRequestType;
    agenda_item_id?: string | null;
    content?: string | null;
  }) => post<MeetingRequestOut>(`/meetings/${id}/requests`, body),
  updateRequest: (id: string, requestId: string, status: MeetingRequestStatus) =>
    patch<MeetingRequestOut>(`/meetings/${id}/requests/${requestId}`, { status }),
  screen: (id: string) => get<MeetingScreenOut>(`/meetings/${id}/screen`),
  updateScreenState: (id: string, body: Partial<{
    agenda_item_id: string | null;
    reading_mode: MeetingScreenReadingMode;
    title: string | null;
    body: string | null;
    active_attachment_id: string | null;
    scroll_position: number;
    auto_scroll: boolean;
    scroll_speed: number;
    is_fullscreen: boolean;
  }>) => patch<MeetingScreenStateOut>(`/meetings/${id}/screen-state`, body),
  publicScreen: (token: string) =>
    get<MeetingScreenOut>(`/public/meetings/screen/${encodeURIComponent(token)}`),
  events: (id: string, limit = 200) =>
    get<MeetingEventOut[]>(`/meetings/${id}/events?limit=${limit}`),
  minutes: (id: string) => get<MeetingMinutesOut>(`/meetings/${id}/minutes`),
  createMinutesDocument: (id: string) =>
    post<{ document_id: string; title: string; status: string }>(
      `/meetings/${id}/minutes/document-draft`,
    ),
};

// ── 電子郵件 ──────────────────────────────────────────────────────────────────

export const emailApi = {
  previewRecipients: (sel: RecipientSelector) =>
    post<RecipientPreviewOut>("/email/preview-recipients", sel),
  preview: (body: EmailComposePayload) =>
    post<{ html: string }>("/email/preview", body),
  test: (body: EmailComposePayload) =>
    post<{ status: string; sent_to: string }>("/email/test", body),
  createMessage: (body: EmailMessageCreate) =>
    post<EmailMessageOut>("/email/messages", body),
  updateMessage: (
    id: string,
    body: Partial<EmailComposePayload> & { scheduled_at?: string | null },
  ) => patch<EmailMessageOut>(`/email/messages/${id}`, body),
  sendMessage: (id: string) => post<EmailMessageOut>(`/email/messages/${id}/send`),
  deleteMessage: (id: string) => del<void>(`/email/messages/${id}`),
  listMessages: (params?: { status?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    return get<EmailMessageOut[]>(`/email/messages${q.size ? `?${q}` : ""}`);
  },
  getMessage: (id: string) => get<EmailMessageDetailOut>(`/email/messages/${id}`),
  orgPositions: (orgId: string) => get<EmailPosition[]>(`/orgs/${orgId}/positions`),
};

// ── 儀表板 / 待辦中心 ─────────────────────────────────────────────────────────

export type DashboardSeverity = "info" | "warning" | "critical";
export type DashboardLayoutHint = "student" | "officer" | "leader";

export interface DashboardWidgetItem {
  title: string;
  subtitle: string | null;
  href: string | null;
  timestamp: string | null;
  badge: string | null;
}

export interface DashboardWidget {
  key: string;
  title: string;
  summary: string | null;
  count: number | null;
  href: string | null;
  severity: DashboardSeverity;
  wide: boolean;
  items: DashboardWidgetItem[];
}

export interface DashboardResponse {
  widgets: DashboardWidget[];
  layout_hint: DashboardLayoutHint;
}

export const dashboardApi = {
  get: () => get<DashboardResponse>("/dashboard"),
};

export type TaskModule =
  | "document" | "meeting" | "regulation" | "petition"
  | "meal" | "shop" | "survey" | "announcement";

export type TaskAction =
  | "approve" | "attend" | "review" | "publish"
  | "reply" | "fill" | "collect" | "pickup" | "sign";

export type TaskSeverity = "info" | "warning" | "critical";

export interface TaskItem {
  id: string;
  module: TaskModule;
  action: TaskAction;
  title: string;
  subtitle: string | null;
  href: string;
  due_at: string | null;
  severity: TaskSeverity;
  created_at: string;
}

export interface TaskInboxResponse {
  items: TaskItem[];
  total: number;
  by_module: Record<string, number>;
}

export const tasksApi = {
  list: () => get<TaskInboxResponse>("/tasks"),
};
