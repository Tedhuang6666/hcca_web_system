import type {
  DocumentOut, DocumentListItem, DocumentCreate,
  DocumentTemplateCreate, DocumentTemplateOut, DocumentTemplateUpdate,
  BatchDocumentOperationOut,
  DocumentApprovalDelegationOut,
  ProductOut, OrderOut, OrderListItem, CartOut, OrderSummaryOut, ShopClassSummaryOut,
  ProductCategoryOut, ProductSeriesOut, ProductVariantGroupOut, ProductVariantOptionOut,
  CatalogCategoryOut,
  ZoneOut, ZoneListItem, SeatInput, WaveInput, SeatMapOut, HoldOut, SeatBookingOut,
  SchoolClassOut, SchoolClassListItem, SchoolClassBulkActionKind, SchoolClassBulkActionOut,
  SchoolClassBulkCreate, SchoolClassBulkCreateOut,
  ClassMemberOut, ClassStudentRangeOut, ClassCadreOut, ClassManualMemberOut,
  ClassMembershipOut, ClassRoleOut,
  PersonAffiliationCreate, PersonAffiliationOut, PersonAffiliationUpdate,
  PersonCreate, PersonDetailOut, PersonListItem, PersonOut, PersonRosterImportResult, PersonUpdate,
  RegulationOut, RegulationListItem, RegulationCategory, RegulationSearchResult,
  AmendmentComparisonRow,
  RegulationArticleOut, RegulationRevisionOut, RegulationWorkflowLogOut, RegulationTreeNodeOut,
  SerialTemplateOut,
  MeetingListItem, MeetingOut, MeetingScreenOut, MeetingMinutesOut, MeetingWorkspaceOut,
  MeetingEventOut,
  MeetingJoinOut, MeetingScreenStateOut, MeetingArtifactLinkOut,
  MeetingAttendanceSourcePreviewOut, MeetingAttendanceSourceOut,
  MeetingMotionOut, MeetingDecisionOut,
  MeetingAgendaAttachmentOut, MeetingAgendaItemOut, MeetingAttendanceOut, MeetingVoteOut, MeetingBallotOut,
  MeetingRequestOut, MeetingBillStage, MeetingRegulationBrief,
  MeetingMode, MeetingVoteRecordMethod, MeetingVoteOption,
  AgendaItemType, AttendanceRole, AttendanceStatus, VoteVisibility, VoteThresholdType, BallotChoice,
  MeetingRequestStatus, MeetingRequestType, AttendanceSourceType, MeetingArtifactType,
  MeetingMotionType, MeetingMotionStatus, MeetingDecisionStatus, MeetingScreenReadingMode,
  MeetingSpeechQueueItemOut, MeetingSpeechQueueStatus,
  CalendarEventCreate, CalendarEventListItem, CalendarEventOut, CalendarEventType,
  CalendarVisibility, CalendarParticipantOut, CalendarParticipantRole,
  CalendarParticipantResponse, CalendarChecklistCreate, CalendarChecklistOut,
  CalendarLinkCreate, CalendarLinkOut,
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
  NavigationProfileCreate, NavigationProfileOut, NavigationProfileResolveOut,
  NavigationProfileUpdate,
  MFASetupOut, MFAStatusOut,
  PetitionCaseListItem, PetitionCaseOut, PetitionCreate, PetitionCreatedOut,
  PetitionStatsOut, PetitionStatus, PetitionTypeOut,
  CouncilProposalCaseType, CouncilProposalCreate, CouncilProposalEligibleMeeting, CouncilProposalListItem, CouncilProposalOut, CouncilProposalStatus,
  JudicialPetitionCreate, JudicialPetitionListItem, JudicialPetitionOut, JudicialPetitionStatus,
  NotificationPreferences,
  SearchResultOut,
  WebPushConfigOut,
  WebPushSubscriptionOut,
  LineBindingOut, LineLinkCodeOut,
  DiscordBindingOut, DiscordGuildConfigIn, DiscordGuildConfigOut,
  DiscordBotHealthOut, DiscordSyncAllOut,
  DiscordChannelOptionOut, DiscordGuildOptionOut, DiscordRoleOptionOut,
  DiscordNicknamePrefixRuleIn, DiscordNicknamePrefixRuleOut,
  DiscordOrgChannelMappingIn, DiscordOrgChannelMappingOut,
  DiscordRoleMappingIn, DiscordRoleMappingOut,
  DiscordRolePolicyIn, DiscordRolePolicyOut, DiscordMemberSyncStateOut,
  DocumentEfficiencyOut, DeptRankingItem, PendingAlertItem, AnnouncementParticipationItem,
  SurveyParticipationItem, AnalyticsInsightsOut,
  EmailCampaignRecipientOut,
  EmailAnalyticsOut, EmailAttachmentOut, EmailPreflightOut,
  EmailRecipientListOut, EmailTemplateOut,
  EmailComposePayload, EmailMessageCreate, EmailMessageOut, EmailMessageDetailOut,
  RecipientSelector, RecipientPreviewOut, EmailPosition, UploadedImageOut,
  PartnerBusinessCreate, PartnerBusinessListItem, PartnerBusinessOut, PartnerBusinessUpdate,
  PartnerLocationCreate, PartnerLocationOut, PartnerLocationUpdate,
  PartnerMapItem, PartnerOfferCreate, PartnerOfferOut, PartnerOfferUpdate,
  PartnerRankingItem, PartnerRatingCreate, PartnerRatingOut,
  PartnerSubmissionCreate, PartnerSubmissionOut,
  PartnerTagCreate, PartnerTagOut, PartnerTagUpdate,
  ExamGradeTrack, ExamPaperDownloadOut, ExamPaperListItem, ExamPaperOut, ExamPaperUpdate,
  ExamTraceInspectOut,
  Activity, ActivityConvener, ActivityCreate, ActivityMember, ActivityRole,
  DiscordActivityWorkspace,
  WorkflowInstanceOut, WorkflowLinkCreate, WorkflowLinkOut, WorkflowTimelineOut,
  WorkflowTransitionCreate,
  ActivityClosingReportOut, ActivityLinkCreate, ActivityLinkOut, ActivityLinkSuggestion,
  ActivitySpawnCreate, ActivitySpawnOut,
  ActivityWorkspaceOut,
  ReceivableOut, ReceivableSummaryOut, ReceivableSource,
  PublicationCampaignOut, PublicationPreviewOut, PublicationStatsOut,
  DocumentApprovalContextOut, MeetingBriefingCardOut, PetitionResolutionContextOut,
  RegulationUsageContextOut,
  WorkItemCreate, WorkItemOut, WorkItemUpdate,
  AutomationRuleCreate, AutomationRuleOut, AutomationRuleUpdate, AutomationMeta,
  MatterLinkRef, MatterSpawnKind, MatterSpawnResult, DecisionCreate, DecisionOut, DecisionUpdate,
  EntityRelationCreate, EntityRelationGraphOut, EntityRelationOut, GovernanceCaseCreate, GovernanceCaseOut,
  GovernanceCaseUpdate, GovernanceDashboardOut, GovernanceWorkflowTemplateCreate,
  GovernanceDiscordEventRouteIn, GovernanceDiscordEventRouteOut,
  GovernanceDiscordWorkspaceIn, GovernanceDiscordWorkspaceOut,
  GovernanceModuleCapabilityOut, GovernanceResourceSearchOut, GovernanceWorkflowTemplateOut,
  MatterCreate, MatterListItem, MatterOut, MatterRoleAssignmentCreate,
  MatterRoleAssignmentOut, MatterRoleAssignmentUpdate, MatterUpdate, PlanningDocumentCreate,
  PlanningDocumentAttachmentOut, PlanningDocumentOut, PlanningDocumentRevisionCreate,
  PlanningDocumentRevisionOut,
  PlanningDocumentUpdate, ProgramCreate, ProgramOut, ProgramUpdate, TimelineEventCreate,
  TimelineEventOut,
  PendingConsentItem, PolicyConsentOut,
  PublicLinkCategoryCreate, PublicLinkCategoryOut, PublicLinkCategoryUpdate,
  PublicLinkCreate, PublicLinkOut, PublicLinkUpdate,
  PublicOfficerCandidateOut, PublicOfficerOut,
  PublicOfficerProfileCreate, PublicOfficerProfileOut, PublicOfficerProfileUpdate,
  PublicSiteBundleOut, PublicSitePageCreate, PublicSitePageOut, PublicSitePageUpdate,
  PublicSiteSettingsOut, PublicSiteSettingsUpdate,
  ElectionOut, ElectionListItem, ElectionLiveSummary, ElectionStatus, BallotBoxStatus,
  VoteEventOut, VoteEventKind,
  LoanAvailableItem, LoanCheckoutCreate, LoanDashboard, LoanItemCreate,
  LoanItemOut, LoanItemUpdate, LoanRecordOut, LoanRecordStatus, LoanRecordUpdate,
  LoanUnitOut, LoanUnitUpdate,
  InventoryCategoryOut, InventoryCategoryCreate, InventoryCategoryUpdate,
  InventoryItemOut, InventoryItemCreate, InventoryItemUpdate, InventoryItemAdjust,
  InventoryItemType, InventoryTxnType, InventoryProcurementStatus,
  InventoryTransactionOut, InventoryProcurementOut,
  InventoryProcurementCreate, InventoryProcurementUpdate, InventoryDashboard,
} from "./types";
import { API_BASE, apiUrl } from "./config";
import { ApiError } from "./api-helpers";
export { ApiError, withFallback, apiErrorMessage } from "./api-helpers";

const BASE = API_BASE;

// ── 核心 fetch 包裝 ────────────────────────────────────────────────────────────

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

interface ResponseErrorDetail {
  message: string;
  requestId: string | null;
  errorId: string | null;
}

async function errorDetailFromResponse(res: Response): Promise<ResponseErrorDetail> {
  let detail: unknown = res.statusText;
  let errorId: string | null = null;
  try {
    const payload: unknown = await res.json();
    if (payload && typeof payload === "object") {
      const record = payload as { detail?: unknown; error_id?: unknown; errors?: unknown };
      detail = record.errors ?? record.detail ?? payload;
      errorId = typeof record.error_id === "string" ? record.error_id : null;
    } else {
      detail = payload;
    }
  } catch {
    // ignore non-JSON error bodies
  }
  const message = formatErrorDetail(detail, res.statusText || "請求失敗");
  const requestId = res.headers.get("X-Request-ID");
  const codes = [
    errorId ? `錯誤代碼 ${errorId}` : null,
    requestId ? `請求代碼 ${requestId}` : null,
  ].filter(Boolean);
  return {
    message: codes.length > 0 ? `${message}（${codes.join("，")}）` : message,
    requestId,
    errorId,
  };
}

async function errorMessageFromResponse(res: Response): Promise<string> {
  return (await errorDetailFromResponse(res)).message;
}

async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  const detail = await errorDetailFromResponse(res);
  return new ApiError(res.status, detail.message, detail.requestId, detail.errorId);
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

// GET 在網路錯誤時最多重試 N 次，間隔逐步加長
const GET_NETWORK_RETRIES = 2;
const RETRY_BACKOFF_MS = [400, 900];

// ── 端點熔斷器 ────────────────────────────────────────────────────────────────
// 同一路徑連續「硬失敗」（網路斷線 / 5xx / 5字頭閘道）達門檻就短暫開斷，
// 開斷期間直接快速失敗，不再對著掛掉的後端雪崩式重打。伺服器只要回得了
// （含 4xx）就算可達 → 重置。與後端 mem_limit/healthcheck 形成前後端雙層保護。
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 60_000;
const circuits = new Map<string, { failures: number; openUntil: number }>();

function circuitKey(path: string): string {
  const q = path.indexOf("?");
  return q === -1 ? path : path.slice(0, q);
}
function circuitOpen(key: string): boolean {
  const c = circuits.get(key);
  return c ? c.openUntil > Date.now() : false;
}
function recordHardFailure(key: string): void {
  const c = circuits.get(key) ?? { failures: 0, openUntil: 0 };
  c.failures += 1;
  if (c.failures >= CIRCUIT_THRESHOLD) c.openUntil = Date.now() + CIRCUIT_OPEN_MS;
  circuits.set(key, c);
}
function recordReachable(key: string): void {
  // 伺服器有回應（即使是 4xx）→ 視為可達，清掉熔斷計數
  if (circuits.has(key)) circuits.delete(key);
}

/** 瀏覽器明確處於離線狀態（navigator.onLine === false）。 */
function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isProtectionRecoveryPath(pathname: string): boolean {
  return ["/login", "/auth", "/admin", "/maintenance"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retriedAfterRefresh = false,
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const cKey = circuitKey(path);

  // 離線：直接快速失敗，不浪費一輪 fetch（由呼叫端/輪詢退避處理）
  if (isOffline()) {
    throw new ApiError(0, "目前處於離線狀態");
  }
  // 熔斷開斷中：同一端點剛連續失敗過，60 秒內不再嘗試
  if (circuitOpen(cKey)) {
    throw new ApiError(0, "暫時無法連線至後端（熔斷中），請稍候再試");
  }

  let res: Response;
  let lastError: unknown = null;
  const maxRetries = method === "GET" ? GET_NETWORK_RETRIES : 0;
  let attempt = 0;
  while (true) {
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
      break;
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries) {
        recordHardFailure(cKey);
        throw new ApiError(0, `無法連線至後端 API：${BASE}`);
      }
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt] ?? 1500));
      attempt += 1;
    }
  }
  void lastError;

  // 熔斷記帳：5xx/5字頭閘道算硬失敗；其餘（含 4xx）代表伺服器可達 → 重置
  if (res.status >= 500) recordHardFailure(cKey);
  else recordReachable(cKey);

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
      throw await apiErrorFromResponse(retry);
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
    throw new ApiError(401, "登入已過期，請重新登入", res.headers.get("X-Request-ID"));
  }

  // 503 + maintenance/load_shed → 先 refresh 一次，讓舊 token 補上 admin/bypass claims
  if (res.status === 503) {
    try {
      const payload = (await res.clone().json()) as {
        detail?: string;
        maintenance?: boolean;
        load_shed?: boolean;
        module_maintenance?: boolean;
        until?: number | null;
      };
      // 模組維護：只關掉該模組，不整站轉址（交由 AppShell gate 顯示插頁）。
      // 廣播事件讓 ModuleStatus context 立即重抓，免等輪詢；照常 fall through 拋 ApiError(503)。
      if (typeof window !== "undefined" && payload.module_maintenance) {
        window.dispatchEvent(new CustomEvent("hcca:module-maintenance"));
      }
      if (
        typeof window !== "undefined"
        && (payload.maintenance || payload.load_shed)
        && !payload.module_maintenance
      ) {
        const hasLocalLogin = Boolean(localStorage.getItem("user_id"));
        if (hasLocalLogin && !retriedAfterRefresh) {
          const refreshed = await silentRefresh();
          if (refreshed) return request<T>(path, init, true);
        }

        const retryAfter = res.headers.get("Retry-After") ?? "30";
        const detail = encodeURIComponent(payload.detail ?? "");
        const kind = payload.maintenance ? "maintenance" : "busy";
        const params = new URLSearchParams({ retry: retryAfter, detail, kind });
        if (payload.until) params.set("until", String(payload.until));
        if (!isProtectionRecoveryPath(window.location.pathname)) {
          window.location.assign(`/maintenance?${params.toString()}`);
        }
      }
    } catch {
      // 非 JSON 回應；fall through
    }
  }

  if (!res.ok) {
    if (res.status === 412 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("hcca:policy-consent-required"));
    }
    if (res.status === 403 && typeof window !== "undefined") {
      const mfaRequired = res.headers.get("X-MFA-Required");
      if (mfaRequired === "true") {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`/settings/security?mfa_required=1&next=${next}`);
        throw new ApiError(403, "需要設定雙重驗證才能存取此功能");
      }
    }
    throw await apiErrorFromResponse(res);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const get = <T>(p: string) => request<T>(p);
const post = <T>(p: string, body?: unknown) => request<T>(p, { method: "POST", body: JSON.stringify(body) });
const patch = <T>(p: string, body: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(body) });
const put = <T>(p: string, body: unknown) => request<T>(p, { method: "PUT", body: JSON.stringify(body) });
const del = <T>(p: string) => request<T>(p, { method: "DELETE" });

export const electionsApi = {
  list: () => get<ElectionListItem[]>("/elections"),
  get: (id: string) => get<ElectionOut>(`/elections/${pathSegment(id)}`),
  create: (body: {
    title: string;
    description?: string;
    is_public?: boolean;
    seats?: number;
    eligible_voter_count?: number | null;
    turnout_threshold_pct?: number | null;
    vote_threshold_pct?: number | null;
    candidates: {
      name: string;
      number: number;
      color: string;
      sort_order?: number;
      members?: { position: string; name: string; photo_url?: string | null; sort_order?: number }[];
    }[];
    ballot_boxes: {
      name: string;
      expected_total_votes?: number | null;
      sort_order?: number;
    }[];
  }) => post<ElectionOut>("/elections", body),
  uploadImage: async (file: File): Promise<{ url: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/elections/images`, {
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
  updateStatus: (id: string, status: ElectionStatus) =>
    post<ElectionOut>(`/elections/${pathSegment(id)}/status`, { status }),
  updateBallotBoxStatus: (id: string, boxId: string, status: BallotBoxStatus) =>
    post(`/elections/${pathSegment(id)}/ballot-boxes/${boxId}/status`, { status }),
  addEvent: (
    id: string,
    body: {
      ballot_box_id: string;
      candidate_id?: string | null;
      kind: VoteEventKind;
      delta: number;
      reason?: string;
    },
  ) => post<VoteEventOut>(`/elections/${pathSegment(id)}/events`, body),
  reverseEvent: (id: string, eventId: string) =>
    post<VoteEventOut>(`/elections/${pathSegment(id)}/events/${eventId}/reverse`),
  events: (id: string, limit = 100) =>
    get<VoteEventOut[]>(`/elections/${pathSegment(id)}/events?limit=${limit}`),
  live: (id: string) =>
    get<ElectionLiveSummary>(`/elections/public/${pathSegment(id)}/live`),
};

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
  /** 後端列印 / 下載 PDF（一般使用者由身份自動判定正/影本；管理員可指定）。
   *  以 fetch + Bearer token 取得 blob，由呼叫端決定預覽或下載。 */
  printPdf: async (
    id: string,
    opts?: { recipientId?: string; variant?: "primary" | "copy" },
  ): Promise<Blob> => {
    const qs = new URLSearchParams();
    if (opts?.recipientId) qs.set("recipient_id", opts.recipientId);
    if (opts?.variant) qs.set("variant", opts.variant);
    const url = `${BASE}/documents/${id}/print${qs.toString() ? `?${qs}` : ""}`;
    const token =
      typeof window !== "undefined" ? (localStorage.getItem("access_token") ?? "") : "";
    const res = await fetch(url, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.blob();
  },
};

// ── 商店 ──────────────────────────────────────────────────────────────────────

export const shopApi = {
  // 瀏覽
  catalog: (activityId?: string) => {
    const q = new URLSearchParams();
    if (activityId) q.set("activity_id", activityId);
    const qs = q.toString();
    return get<CatalogCategoryOut[]>(`/shop/catalog${qs ? `?${qs}` : ""}`);
  },
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
  listClassOrders: (params?: {
    is_paid?: string;
    assisted_only?: string;
    product_id?: string;
    limit?: string;
    offset?: string;
  }) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<OrderListItem[]>(`/shop/orders/class${qs}`);
  },
  classSummary: (params?: {
    is_paid?: string;
    assisted_only?: string;
    product_id?: string;
  }) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<ShopClassSummaryOut>(`/shop/orders/class/summary${qs}`);
  },
  orderSummary: (params: {
    group_by: "class" | "grade" | "user";
    activity_id?: string;
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
  createClassOrder: (body: {
    user_id: string;
    items: { product_id: string; quantity: number; option_ids: string[] }[];
    notes?: string | null;
  }) => post<OrderOut[]>("/shop/orders/class", body),
  updateOrder: (id: string, body: {
    user_id: string;
    items: { product_id: string; quantity: number; option_ids: string[] }[];
    notes?: string | null;
  }) => patch<OrderOut>(`/shop/orders/${id}`, body),
  cancelOrder: (id: string, reason?: string) =>
    post<OrderOut>(`/shop/orders/${id}/cancel`, { reason }),
  setOrderPaid: (id: string, isPaid: boolean) =>
    patch<OrderOut>(`/shop/orders/${id}/payment`, { is_paid: isPaid }),
  downloadReport: (format: "xlsx" | "csv", params?: { activity_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.activity_id) q.set("activity_id", params.activity_id);
    const qs = q.toString();
    return fetch(`${BASE}/shop/reports/orders.${format}${qs ? `?${qs}` : ""}`, {
      credentials: "include",
    });
  },

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

// ── 劃位 / 票券 ────────────────────────────────────────────────────────────────

export const seatingApi = {
  // 管理：場次與座位圖
  listZones: (productId: string) => get<ZoneListItem[]>(`/seating/products/${productId}/zones`),
  getZone: (zoneId: string) => get<ZoneOut>(`/seating/zones/${zoneId}`),
  createZone: (body: {
    product_id: string; name: string; description?: string | null;
    starts_at?: string | null; seating_opens_at?: string | null;
    hold_minutes?: number; layout?: Record<string, unknown>; sort_order?: number;
  }) => post<ZoneOut>("/seating/zones", body),
  updateZone: (zoneId: string, body: Record<string, unknown>) =>
    patch<ZoneOut>(`/seating/zones/${zoneId}`, body),
  deleteZone: (zoneId: string) => del<void>(`/seating/zones/${zoneId}`),
  saveSeats: (zoneId: string, body: { layout?: Record<string, unknown>; seats: SeatInput[] }) =>
    request<ZoneOut>(`/seating/zones/${zoneId}/seats`, { method: "PUT", body: JSON.stringify(body) }),
  saveWaves: (zoneId: string, body: { waves: WaveInput[] }) =>
    request<ZoneOut>(`/seating/zones/${zoneId}/waves`, { method: "PUT", body: JSON.stringify(body) }),
  zoneAssignments: (zoneId: string) => get<SeatBookingOut[]>(`/seating/zones/${zoneId}/assignments`),
  releaseAssignment: (assignmentId: string) => del<void>(`/seating/assignments/${assignmentId}`),
  adminAssign: (body: { order_id: string; seat_ids: string[] }) =>
    post<SeatBookingOut[]>("/seating/assign", body),

  // 使用者自助選位
  seatMap: (zoneId: string, orderId?: string) =>
    get<SeatMapOut>(`/seating/zones/${zoneId}/map${orderId ? `?order_id=${orderId}` : ""}`),
  hold: (zoneId: string, seatIds: string[]) =>
    post<HoldOut>(`/seating/zones/${zoneId}/hold`, { seat_ids: seatIds }),
  releaseHold: (zoneId: string) => del<void>(`/seating/zones/${zoneId}/hold`),
  select: (body: { order_id: string; seat_ids: string[] }) =>
    post<SeatBookingOut[]>("/seating/select", body),
  orderAssignments: (orderId: string) =>
    get<SeatBookingOut[]>(`/seating/orders/${orderId}/assignments`),
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
  bulkAction: (classIds: string[], action: SchoolClassBulkActionKind) =>
    post<SchoolClassBulkActionOut>("/classes/bulk/action", { class_ids: classIds, action }),
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

// ── 人員與身分總表 ────────────────────────────────────────────────────────────

export const peopleApi = {
  list: (params?: {
    keyword?: string;
    class_id?: string;
    org_id?: string;
    position_id?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = params ? `?${new URLSearchParams(
      Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
        if (value !== undefined && value !== null && value !== "") acc[key] = String(value);
        return acc;
      }, {}),
    ).toString()}` : "";
    return get<PersonListItem[]>(`/people${qs}`);
  },
  create: (body: PersonCreate) => post<PersonOut>("/people", body),
  get: (id: string) => get<PersonDetailOut>(`/people/${id}`),
  update: (id: string, body: PersonUpdate) => patch<PersonOut>(`/people/${id}`, body),
  importRoster: (rows: Array<{
    student_id: string;
    display_name: string;
    email?: string | null;
    class_id?: string | null;
    academic_year?: number | null;
    note?: string | null;
  }>) => post<PersonRosterImportResult>("/people/import-roster", { rows }),
  createAffiliation: (body: PersonAffiliationCreate) =>
    post<PersonAffiliationOut>("/people/affiliations", body),
  updateAffiliation: (id: string, body: PersonAffiliationUpdate) =>
    patch<PersonAffiliationOut>(`/people/affiliations/${id}`, body),
  endAffiliation: (id: string) => del<PersonAffiliationOut>(`/people/affiliations/${id}`),
  syncPending: (id: string) => post<{ synced: number }>(`/people/${id}/sync-pending`, {}),
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
    is_owner?: boolean;
    permissions: string[];
  }>("/auth/me"),
  googleOneTap: (credential: string, next?: string) =>
    post<{
      mfa_required: boolean;
      challenge?: string;
      next: string;
      user?: {
        id: string;
        display_name: string;
        email: string;
        avatar_url?: string | null;
        is_superuser?: boolean;
        is_owner?: boolean;
        permissions: string[];
      };
    }>("/auth/google/one-tap", { credential, next }),
};

export const mfaApi = {
  status: () => get<MFAStatusOut>("/auth/mfa/status"),
  setup: () => post<MFASetupOut>("/auth/mfa/setup", {}),
  confirm: (code: string) => post<{ message: string }>("/auth/mfa/confirm", { code }),
  verify: (code: string) => post<{ verified: boolean }>("/auth/mfa/verify", { code }),
  exchangeChallenge: () => get<{ challenge: string }>("/auth/mfa/exchange-challenge"),
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

export const lineApi = {
  me: () => get<LineBindingOut>("/line/me"),
  createLinkCode: () => post<LineLinkCodeOut>("/line/link-code", {}),
  unlink: () => del<void>("/line/me"),
};

export const discordApi = {
  me: () => get<DiscordBindingOut>("/discord/me"),
  loginUrl: (next = "/dashboard") => `${BASE}/discord/login?next=${encodeURIComponent(next)}`,
  unlink: () => del<void>("/discord/me"),
  syncMe: () => post<void>("/discord/me/sync", {}),
  health: () => get<DiscordBotHealthOut>("/discord/health"),
  syncAll: () => post<DiscordSyncAllOut>("/discord/sync-all", {}),
  testMessage: (body: { channel_id: string; message?: string }) =>
    post<void>("/discord/test-message", body),
  availableGuilds: () => get<DiscordGuildOptionOut[]>("/discord/available-guilds"),
  guildChannels: (guildId: string) =>
    get<DiscordChannelOptionOut[]>(`/discord/guilds/${encodeURIComponent(guildId)}/channels`),
  guildRoles: (guildId: string) =>
    get<DiscordRoleOptionOut[]>(`/discord/guilds/${encodeURIComponent(guildId)}/roles`),
  listGuildConfigs: () => get<DiscordGuildConfigOut[]>("/discord/guild-configs"),
  saveGuildConfig: (body: DiscordGuildConfigIn) =>
    post<DiscordGuildConfigOut>("/discord/guild-configs", body),
  listOrgChannelMappings: () =>
    get<DiscordOrgChannelMappingOut[]>("/discord/org-channel-mappings"),
  saveOrgChannelMapping: (body: DiscordOrgChannelMappingIn) =>
    post<DiscordOrgChannelMappingOut>("/discord/org-channel-mappings", body),
  deleteOrgChannelMapping: (id: string) => del<void>(`/discord/org-channel-mappings/${id}`),
  listNicknamePrefixRules: () =>
    get<DiscordNicknamePrefixRuleOut[]>("/discord/nickname-prefix-rules"),
  createNicknamePrefixRule: (body: DiscordNicknamePrefixRuleIn) =>
    post<DiscordNicknamePrefixRuleOut>("/discord/nickname-prefix-rules", body),
  updateNicknamePrefixRule: (id: string, body: DiscordNicknamePrefixRuleIn) =>
    patch<DiscordNicknamePrefixRuleOut>(`/discord/nickname-prefix-rules/${id}`, body),
  deleteNicknamePrefixRule: (id: string) => del<void>(`/discord/nickname-prefix-rules/${id}`),
  listRoleMappings: () => get<DiscordRoleMappingOut[]>("/discord/role-mappings"),
  createRoleMapping: (body: DiscordRoleMappingIn) =>
    post<DiscordRoleMappingOut>("/discord/role-mappings", body),
  updateRoleMapping: (id: string, body: DiscordRoleMappingIn) =>
    patch<DiscordRoleMappingOut>(`/discord/role-mappings/${id}`, body),
  deleteRoleMapping: (id: string) => del<void>(`/discord/role-mappings/${id}`),
  listRolePolicies: (guildId?: string) =>
    get<DiscordRolePolicyOut[]>(
      `/discord/role-policies${guildId ? `?guild_id=${encodeURIComponent(guildId)}` : ""}`,
    ),
  createRolePolicy: (body: DiscordRolePolicyIn) =>
    post<DiscordRolePolicyOut>("/discord/role-policies", body),
  updateRolePolicy: (id: string, body: DiscordRolePolicyIn) =>
    patch<DiscordRolePolicyOut>(`/discord/role-policies/${id}`, body),
  deleteRolePolicy: (id: string) => del<void>(`/discord/role-policies/${id}`),
  memberSyncStates: (guildId?: string, driftOnly = false) => {
    const q = new URLSearchParams();
    if (guildId) q.set("guild_id", guildId);
    if (driftOnly) q.set("drift_only", "true");
    return get<DiscordMemberSyncStateOut[]>(`/discord/member-sync-states?${q.toString()}`);
  },
  repairMemberSyncState: (id: string) =>
    post<void>(`/discord/member-sync-states/${id}/repair`, {}),
  repairMemberSyncStates: (stateIds: string[] = []) =>
    post<{ queued: number }>("/discord/member-sync-states/repair", {
      state_ids: stateIds,
      drift_only: true,
    }),
};

export const workItemsApi = {
  list: (params?: { assigned_to_id?: string; include_done?: boolean; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.assigned_to_id) search.set("assigned_to_id", params.assigned_to_id);
    if (params?.include_done) search.set("include_done", "true");
    if (params?.limit) search.set("limit", String(params.limit));
    const qs = search.toString();
    return get<WorkItemOut[]>(`/work-items${qs ? `?${qs}` : ""}`);
  },
  create: (body: WorkItemCreate) => post<WorkItemOut>("/work-items", body),
  update: (id: string, body: WorkItemUpdate) => patch<WorkItemOut>(`/work-items/${id}`, body),
  complete: (id: string) => post<WorkItemOut>(`/work-items/${id}/complete`, {}),
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
  /** 取得當前使用者有 document:create 或 document:draft 權限的組織列表（RBAC 過濾） */
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
    leader_user_id?: string | null;
    note?: string | null;
    remark?: string | null;
    is_active?: boolean;
  }) =>
    patch<OrgRead>(`/orgs/${id}`, data),
};

// ── 活動 ──────────────────────────────────────────────────────────────────────

export const activitiesApi = {
  list: (params?: { org_id?: string; active_only?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.active_only !== undefined) q.set("active_only", String(params.active_only));
    const qs = q.toString();
    return get<Activity[]>(`/activities${qs ? `?${qs}` : ""}`);
  },
  mine: (activeOnly = true) =>
    get<Activity[]>(`/activities/mine?active_only=${String(activeOnly)}`),
  get: (id: string) => get<Activity>(`/activities/${id}`),
  workspace: (id: string) => get<ActivityWorkspaceOut>(`/activities/${id}/workspace`),
  spawn: (id: string, body: ActivitySpawnCreate) =>
    post<ActivitySpawnOut>(`/activities/${id}/spawn`, body),
  links: (id: string) => get<ActivityLinkOut[]>(`/activities/${id}/links`),
  createLink: (id: string, body: ActivityLinkCreate) =>
    post<ActivityLinkOut>(`/activities/${id}/links`, body),
  linkResource: (id: string, body: ActivityLinkCreate) =>
    post<ActivityLinkOut>(`/activities/${id}/links`, body),
  deleteLink: (activityId: string, linkId: string) =>
    del<void>(`/activities/${activityId}/links/${linkId}`),
  linkSuggestions: (id: string, limit = 20) =>
    get<ActivityLinkSuggestion[]>(`/activities/${id}/link-suggestions?limit=${limit}`),
  acceptSuggestion: (id: string, suggestionId: string) =>
    post<ActivityLinkOut>(
      `/activities/${id}/link-suggestions/${encodeURIComponent(suggestionId)}/accept`,
      {},
    ),
  closingReport: (id: string) =>
    get<ActivityClosingReportOut>(`/activities/${id}/closing-report`),
  create: (body: ActivityCreate) => post<Activity>("/activities", body),
  update: (id: string, body: Partial<ActivityCreate> & { is_active?: boolean }) =>
    patch<Activity>(`/activities/${id}`, body),
  archive: (id: string) => post<Activity>(`/activities/${id}/archive`, {}),
  listConveners: (id: string) => get<ActivityConvener[]>(`/activities/${id}/conveners`),
  appointConvener: (id: string, body: { user_id: string; start_date: string; end_date?: string | null }) =>
    post<ActivityConvener>(`/activities/${id}/conveners`, body),
  updateConvener: (id: string, body: { start_date?: string; end_date?: string | null }) =>
    patch<ActivityConvener>(`/activities/conveners/${id}`, body),
  removeConvener: (id: string) => del<void>(`/activities/conveners/${id}`),
  discordWorkspace: (id: string) =>
    get<DiscordActivityWorkspace | null>(`/activities/${id}/discord-workspace`),
  saveDiscordWorkspace: (
    id: string,
    body: Omit<
      DiscordActivityWorkspace,
      "id" | "activity_id" | "sync_status" | "last_error" | "last_synced_at" | "created_at" | "updated_at"
    >,
  ) => put<DiscordActivityWorkspace>(`/activities/${id}/discord-workspace`, body),
  syncDiscordWorkspace: (id: string) =>
    post<DiscordActivityWorkspace>(`/activities/${id}/discord-workspace/sync`, {}),
  listRoles: (id: string) => get<ActivityRole[]>(`/activities/${id}/roles`),
  createRole: (
    id: string,
    body: { key: string; name: string; description?: string | null; create_private_channel: boolean },
  ) => post<ActivityRole>(`/activities/${id}/roles`, body),
  updateRole: (activityId: string, roleId: string, body: Partial<ActivityRole>) =>
    patch<ActivityRole>(`/activities/${activityId}/roles/${roleId}`, body),
  listMembers: (id: string) => get<ActivityMember[]>(`/activities/${id}/members`),
  appointMember: (
    id: string,
    body: { role_id: string; user_id: string; start_date: string; end_date?: string | null },
  ) => post<ActivityMember>(`/activities/${id}/members`, body),
  removeMember: (activityId: string, memberId: string) =>
    del<void>(`/activities/${activityId}/members/${memberId}`),
};

// ── 跨模組工作流 ──────────────────────────────────────────────────────────────

export const workflowsApi = {
  list: (params?: {
    workflow_type?: string;
    status?: string;
    activity_id?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.workflow_type) q.set("workflow_type", params.workflow_type);
    if (params?.status) q.set("status", params.status);
    if (params?.activity_id) q.set("activity_id", params.activity_id);
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<WorkflowInstanceOut[]>(`/workflows/instances${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => get<WorkflowInstanceOut>(`/workflows/instances/${id}`),
  transition: (id: string, body: WorkflowTransitionCreate) =>
    post<WorkflowInstanceOut>(`/workflows/instances/${id}/transition`, body),
  timeline: (id: string) =>
    get<WorkflowTimelineOut>(`/workflows/instances/${id}/timeline`),
  createLink: (id: string, body: WorkflowLinkCreate) =>
    post<WorkflowLinkOut>(`/workflows/instances/${id}/links`, body),
};

export const governanceApi = {
  dashboard: () => get<GovernanceDashboardOut>("/governance/dashboard"),
  listMatters: (params?: {
    status?: string;
    matter_type?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.matter_type) q.set("matter_type", params.matter_type);
    if (params?.q) q.set("q", params.q);
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<MatterListItem[]>(`/governance/matters${qs ? `?${qs}` : ""}`);
  },
  createMatter: (body: MatterCreate) => post<MatterOut>("/governance/matters", body),
  getMatter: (id: string) => get<MatterOut>(`/governance/matters/${id}`),
  discordWorkspace: (id: string) =>
    get<GovernanceDiscordWorkspaceOut | null>(
      `/governance/matters/${id}/discord-workspace`,
    ),
  saveDiscordWorkspace: (id: string, body: GovernanceDiscordWorkspaceIn) =>
    put<GovernanceDiscordWorkspaceOut>(
      `/governance/matters/${id}/discord-workspace`,
      body,
    ),
  syncDiscordWorkspace: (id: string) =>
    post<GovernanceDiscordWorkspaceOut>(
      `/governance/matters/${id}/discord-workspace/sync`,
      {},
    ),
  discordRoutes: (id: string) =>
    get<GovernanceDiscordEventRouteOut[]>(
      `/governance/matters/${id}/discord-routes`,
    ),
  saveDiscordRoute: (id: string, body: GovernanceDiscordEventRouteIn) =>
    put<GovernanceDiscordEventRouteOut>(
      `/governance/matters/${id}/discord-routes`,
      body,
    ),
  updateMatter: (id: string, body: MatterUpdate) =>
    patch<MatterOut>(`/governance/matters/${id}`, body),
  createProgram: (matterId: string, body: ProgramCreate) =>
    post<ProgramOut>(`/governance/matters/${matterId}/programs`, body),
  updateProgram: (id: string, body: ProgramUpdate) =>
    patch<ProgramOut>(`/governance/programs/${id}`, body),
  createCase: (matterId: string, body: GovernanceCaseCreate) =>
    post<GovernanceCaseOut>(`/governance/matters/${matterId}/cases`, body),
  updateCase: (id: string, body: GovernanceCaseUpdate) =>
    patch<GovernanceCaseOut>(`/governance/cases/${id}`, body),
  createRelation: (matterId: string, body: EntityRelationCreate) =>
    post<EntityRelationOut>(`/governance/matters/${matterId}/relations`, body),
  listEntityRelations: (entityType: string, entityId: string) =>
    get<EntityRelationOut[]>(
      `/governance/entities/${encodeURIComponent(entityType)}/${entityId}/relations`,
    ),
  createEntityRelation: (
    entityType: string,
    entityId: string,
    body: EntityRelationCreate,
  ) =>
    post<EntityRelationOut>(
      `/governance/entities/${encodeURIComponent(entityType)}/${entityId}/relations`,
      body,
    ),
  entityGraph: (entityType: string, entityId: string, depth = 2) =>
    get<EntityRelationGraphOut>(
      `/governance/entities/${encodeURIComponent(entityType)}/${entityId}/graph?depth=${depth}`,
    ),
  deleteRelation: (relationId: string) => del<void>(`/governance/relations/${relationId}`),
  linksForTarget: (targetType: string, targetId: string) =>
    get<MatterLinkRef[]>(
      `/governance/links?target_type=${encodeURIComponent(targetType)}&target_id=${targetId}`,
    ),
  spawn: (matterId: string, body: { kind: MatterSpawnKind; title: string; org_id?: string | null }) =>
    post<MatterSpawnResult>(`/governance/matters/${matterId}/spawn`, body),
  createEvent: (matterId: string, body: TimelineEventCreate) =>
    post<TimelineEventOut>(`/governance/matters/${matterId}/events`, body),
  listTasks: (matterId: string, includeDone = true) =>
    get<WorkItemOut[]>(
      `/governance/matters/${matterId}/tasks?include_done=${String(includeDone)}`,
    ),
  createTask: (matterId: string, body: WorkItemCreate) =>
    post<WorkItemOut>(`/governance/matters/${matterId}/tasks`, body),
  createDecision: (matterId: string, body: DecisionCreate) =>
    post<DecisionOut>(`/governance/matters/${matterId}/decisions`, body),
  updateDecision: (id: string, body: DecisionUpdate) =>
    patch<DecisionOut>(`/governance/decisions/${id}`, body),
  createPlanningDocument: (matterId: string, body: PlanningDocumentCreate) =>
    post<PlanningDocumentOut>(`/governance/matters/${matterId}/planning-documents`, body),
  updatePlanningDocument: (id: string, body: PlanningDocumentUpdate) =>
    patch<PlanningDocumentOut>(`/governance/planning-documents/${id}`, body),
  createPlanningRevision: (id: string, body: PlanningDocumentRevisionCreate) =>
    post<PlanningDocumentRevisionOut>(`/governance/planning-documents/${id}/revisions`, body),
  moduleCapabilities: () =>
    get<GovernanceModuleCapabilityOut[]>("/governance/module-capabilities"),
  searchResources: (kind: string, q: string, limit = 20) =>
    get<GovernanceResourceSearchOut[]>(
      `/governance/resources/search?${new URLSearchParams({
        kind,
        q,
        limit: String(limit),
      }).toString()}`,
    ),
  uploadPlanningAttachment: async (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/governance/planning-documents/${id}/attachments`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: form,
      });
    let response = await doFetch();
    if (response.status === 401 && await silentRefresh()) response = await doFetch();
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new ApiError(
        response.status,
        formatErrorDetail(payload?.detail, "附件上傳失敗"),
      );
    }
    return response.json() as Promise<PlanningDocumentAttachmentOut>;
  },
  renamePlanningAttachment: (documentId: string, attachmentId: string, displayName: string) =>
    patch<PlanningDocumentAttachmentOut>(
      `/governance/planning-documents/${documentId}/attachments/${attachmentId}`,
      { display_name: displayName },
    ),
  deletePlanningAttachment: (documentId: string, attachmentId: string) =>
    del<void>(`/governance/planning-documents/${documentId}/attachments/${attachmentId}`),
  planningAttachmentDownloadUrl: (documentId: string, attachmentId: string) =>
    `${BASE}/governance/planning-documents/${documentId}/attachments/${attachmentId}/download`,
  planningAttachmentPreviewUrl: (documentId: string, attachmentId: string) =>
    `${BASE}/governance/planning-documents/${documentId}/attachments/${attachmentId}/preview`,
  createRoleAssignment: (matterId: string, body: MatterRoleAssignmentCreate) =>
    post<MatterRoleAssignmentOut>(`/governance/matters/${matterId}/roles`, body),
  updateRoleAssignment: (id: string, body: MatterRoleAssignmentUpdate) =>
    patch<MatterRoleAssignmentOut>(`/governance/roles/${id}`, body),
  listWorkflowTemplates: () =>
    get<GovernanceWorkflowTemplateOut[]>("/governance/workflow-templates"),
  createWorkflowTemplate: (body: GovernanceWorkflowTemplateCreate) =>
    post<GovernanceWorkflowTemplateOut>("/governance/workflow-templates", body),
  listAutomationRules: (matterId?: string) =>
    get<AutomationRuleOut[]>(
      `/governance/automation-rules${matterId ? `?matter_id=${matterId}` : ""}`,
    ),
  createAutomationRule: (body: AutomationRuleCreate) =>
    post<AutomationRuleOut>("/governance/automation-rules", body),
  updateAutomationRule: (id: string, body: AutomationRuleUpdate) =>
    patch<AutomationRuleOut>(`/governance/automation-rules/${id}`, body),
  automationMeta: () => get<AutomationMeta>("/governance/automation-meta"),
};

export const receivablesApi = {
  list: (params?: {
    activity_id?: string; class_id?: string; user_id?: string; status?: string; limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.activity_id) q.set("activity_id", params.activity_id);
    if (params?.class_id) q.set("class_id", params.class_id);
    if (params?.user_id) q.set("user_id", params.user_id);
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return get<ReceivableOut[]>(`/receivables${qs ? `?${qs}` : ""}`);
  },
  summary: (params?: { activity_id?: string; class_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.activity_id) q.set("activity_id", params.activity_id);
    if (params?.class_id) q.set("class_id", params.class_id);
    const qs = q.toString();
    return get<ReceivableSummaryOut>(`/receivables/summary${qs ? `?${qs}` : ""}`);
  },
  create: (body: {
    source_type?: ReceivableSource; source_id?: string | null; activity_id?: string | null;
    org_id?: string | null; user_id?: string | null; class_id?: string | null;
    title: string; amount: number; due_at?: string | null; note?: string | null;
  }) => post<ReceivableOut>("/receivables", body),
  update: (id: string, body: Partial<ReceivableOut>) =>
    patch<ReceivableOut>(`/receivables/${id}`, body),
  markPaid: (id: string, body: { paid_amount?: number | null; note?: string | null } = {}) =>
    post<ReceivableOut>(`/receivables/${id}/mark-paid`, body),
  refund: (id: string, body: { refunded_amount?: number | null; note?: string | null } = {}) =>
    post<ReceivableOut>(`/receivables/${id}/refund`, body),
  exportUrl: (params?: { activity_id?: string; class_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.activity_id) q.set("activity_id", params.activity_id);
    if (params?.class_id) q.set("class_id", params.class_id);
    const qs = q.toString();
    return `${BASE}/receivables/export.csv${qs ? `?${qs}` : ""}`;
  },
};

export const publicationsApi = {
  list: (params?: { activity_id?: string; status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.activity_id) q.set("activity_id", params.activity_id);
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return get<PublicationCampaignOut[]>(`/publications${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => get<PublicationCampaignOut>(`/publications/${id}`),
  create: (body: {
    title: string; body: string; source_type?: string | null; source_id?: string | null;
    activity_id?: string | null; org_id?: string | null; audience_type?: string;
    audience_filter?: Record<string, unknown>; channels: string[]; scheduled_at?: string | null;
  }) => post<PublicationCampaignOut>("/publications", body),
  update: (id: string, body: Partial<PublicationCampaignOut>) =>
    patch<PublicationCampaignOut>(`/publications/${id}`, body),
  preview: (id: string) => post<PublicationPreviewOut>(`/publications/${id}/preview`, {}),
  send: (id: string) => post<PublicationCampaignOut>(`/publications/${id}/send`, {}),
  stats: (id: string) => get<PublicationStatsOut>(`/publications/${id}/stats`),
};

export const contextApi = {
  meetingBriefing: (id: string) => get<MeetingBriefingCardOut>(`/meetings/${id}/briefing-card`),
  documentApproval: (id: string) =>
    get<DocumentApprovalContextOut>(`/documents/${id}/approval-context`),
  petitionResolution: (id: string) =>
    get<PetitionResolutionContextOut>(`/petitions/${id}/resolution-context`),
  regulationUsage: (id: string) =>
    get<RegulationUsageContextOut>(`/regulations/${id}/usage-context`),
};

// ── 管理員 ────────────────────────────────────────────────────────────────────

import type {
  AdminUserDetail, OrgWithPositions, PermissionCodeInfo, PositionCategory, PositionSummary,
  UserBatchPreRegisterResult,
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
  updateUser: (id: string, body: {
    display_name?: string;
    is_active?: boolean;
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
  }) => post<OrgRead>("/orgs", body),
  updateOrg: (id: string, body: {
    name?: string;
    description?: string | null;
    parent_id?: string | null;
    prefix?: string | null;
    bill_stage?: MeetingBillStage | null;
    leader_user_id?: string | null;
    note?: string | null;
    remark?: string | null;
    is_active?: boolean;
  }) => patch<OrgRead>(`/orgs/${id}`, body),
  deleteOrg: (id: string) => del<void>(`/orgs/${id}`),
  deactivateOrg: (id: string) => post<OrgRead>(`/orgs/${id}/deactivate`, {}),
  activateOrg: (id: string) => post<OrgRead>(`/orgs/${id}/activate`, {}),
};

export const navigationProfilesApi = {
  list: (includeInactive = true) =>
    get<NavigationProfileOut[]>(
      `/admin/navigation-profiles?include_inactive=${String(includeInactive)}`,
    ),
  me: () => get<NavigationProfileResolveOut>("/admin/navigation-profiles/me"),
  create: (body: NavigationProfileCreate) =>
    post<NavigationProfileOut>("/admin/navigation-profiles", body),
  update: (id: string, body: NavigationProfileUpdate) =>
    patch<NavigationProfileOut>(`/admin/navigation-profiles/${id}`, body),
  delete: (id: string) => del<void>(`/admin/navigation-profiles/${id}`),
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
  getDigestFrequency: () =>
    get<{ frequency: "off" | "daily" | "weekly" }>("/notifications/preferences/digest"),
  setDigestFrequency: (frequency: "off" | "daily" | "weekly") =>
    put<{ frequency: "off" | "daily" | "weekly" }>(
      "/notifications/preferences/digest",
      { frequency },
    ),
  unsubscribe: (token: string) =>
    post<{ status: string; type: string; message: string }>(
      "/notifications/unsubscribe",
      { token },
    ),
  webPushConfig: () => get<WebPushConfigOut>("/notifications/web-push/config"),
  saveWebPushSubscription: (body: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    device_label?: string;
  }) => post<WebPushSubscriptionOut>("/notifications/web-push/subscriptions", body),
  listWebPushSubscriptions: () =>
    get<WebPushSubscriptionOut[]>("/notifications/web-push/subscriptions"),
  deleteWebPushSubscription: (id: string) =>
    del<void>(`/notifications/web-push/subscriptions/${id}`),
  testWebPush: () => post<{ sent: number }>("/notifications/web-push/test", {}),
};

export const searchApi = {
  global: (q: string, limit = 10) =>
    get<SearchResultOut[]>(`/search?${new URLSearchParams({ q, limit: String(limit) })}`),
  reindex: () => post<{ enabled: boolean; indexed: number; index?: string | null }>(
    "/search/reindex",
    {},
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
  createClassOrder: (body: {
    user_id: string;
    order: {
      schedule_id?: string | null; pickup_slot_id?: string | null;
      items: { menu_item_id?: string | null; availability_id?: string | null; quantity: number }[];
      notes?: string | null;
    };
  }) => post<MealOrderOut>("/meal/orders/class", body),
  updateOrder: (id: string, body: {
    schedule_id?: string | null; pickup_slot_id?: string | null;
    items: { menu_item_id?: string | null; availability_id?: string | null; quantity: number }[];
    notes?: string | null;
  }) => patch<MealOrderOut>(`/meal/orders/${id}`, body),
  cancelOrder: (id: string, reason?: string) =>
    post<MealOrderOut>(`/meal/orders/${id}/cancel`, { reason }),
  confirmOrder: (id: string) => post<MealOrderOut>(`/meal/orders/${id}/confirm`),
  completeOrder: (id: string) => post<MealOrderOut>(`/meal/orders/${id}/complete`),
  setOrderPaid: (id: string, isPaid: boolean) =>
    post<MealOrderOut>(`/meal/orders/${id}/payment?is_paid=${String(isPaid)}`),
  listClassOrders: (params?: { vendor_id?: string; pickup_slot_id?: string; is_paid?: boolean; assisted_only?: boolean; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.vendor_id) q.set("vendor_id", params.vendor_id);
    if (params?.pickup_slot_id) q.set("pickup_slot_id", params.pickup_slot_id);
    if (params?.is_paid !== undefined) q.set("is_paid", String(params.is_paid));
    if (params?.assisted_only !== undefined) q.set("assisted_only", String(params.assisted_only));
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
  option_config?: { exclusive: string[]; other: string[] } | null;
  order_index?: number;
};

export const surveysApi = {
  list: (params?: { status?: string; org_id?: string; activity_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.org_id) q.set("org_id", params.org_id);
    if (params?.activity_id) q.set("activity_id", params.activity_id);
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
  create: (body: { title: string; description?: string; is_anonymous?: boolean; allow_multiple?: boolean; opens_at?: string; closes_at?: string; org_id: string; activity_id?: string | null; is_public?: boolean; allowed_org_ids?: string[]; allowed_user_ids?: string[]; allowed_domains?: string[] }) =>
    post<SurveyOut>("/surveys", body),
  update: (id: string, body: { title?: string; description?: string; opens_at?: string; closes_at?: string; activity_id?: string | null; is_public?: boolean; allowed_org_ids?: string[]; allowed_user_ids?: string[]; allowed_domains?: string[] }) =>
    patch<SurveyOut>(`/surveys/${pathSegment(id)}`, body),
  open: (id: string) => post<SurveyOut>(`/surveys/${pathSegment(id)}/open`),
  close: (id: string) => post<SurveyOut>(`/surveys/${pathSegment(id)}/close`),
  addQuestion: (id: string, body: SurveyQuestionBody & { question_text: string; question_type: string }) =>
    post<SurveyQuestionOut>(`/surveys/${pathSegment(id)}/questions`, body),
  updateQuestion: (questionId: string, body: SurveyQuestionBody) =>
    patch<SurveyQuestionOut>(`/surveys/questions/${questionId}`, body),
  deleteQuestion: (questionId: string) => del<void>(`/surveys/questions/${questionId}`),
  submit: (id: string, body: { answers: { question_id: string; answer_text?: string; answer_options?: string[]; other_text?: string }[]; anon_token?: string; email_copy?: boolean }) =>
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

// ── 議會提案 ───────────────────────────────────────────────────────────────

function councilProposalQuery(params?: {
  status?: CouncilProposalStatus;
  case_type?: CouncilProposalCaseType;
}): string {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.case_type) sp.set("case_type", params.case_type);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export const councilProposalsApi = {
  create: (body: CouncilProposalCreate) => post<CouncilProposalOut>("/council-proposals", body),
  my: (params?: { status?: CouncilProposalStatus; case_type?: CouncilProposalCaseType }) => {
    const qs = councilProposalQuery(params);
    return get<CouncilProposalListItem[]>(`/council-proposals/my${qs}`);
  },
  list: (params?: { status?: CouncilProposalStatus; case_type?: CouncilProposalCaseType }) => {
    const qs = councilProposalQuery(params);
    return get<CouncilProposalListItem[]>(`/council-proposals${qs}`);
  },
  get: (id: string) => get<CouncilProposalOut>(`/council-proposals/${id}`),
  updateStatus: (
    id: string,
    body: {
      status: CouncilProposalStatus;
      committee_review_note?: string | null;
      scheduled_meeting_id?: string | null;
    },
  ) => patch<CouncilProposalOut>(`/council-proposals/${id}/status`, body),
  eligibleMeetings: (id: string) =>
    get<CouncilProposalEligibleMeeting[]>(`/council-proposals/${id}/eligible-meetings`),
  schedule: (id: string, body: { meeting_id: string; note?: string | null }) =>
    post<CouncilProposalOut>(`/council-proposals/${id}/schedule`, body),
};

// ── 評議委員會訴訟 ───────────────────────────────────────────────────────

export const judicialPetitionsApi = {
  create: (body: JudicialPetitionCreate) => post<JudicialPetitionOut>("/judicial-petitions", body),
  my: (params?: { status?: JudicialPetitionStatus }) => {
    const qs = params?.status
      ? `?${new URLSearchParams({ status: params.status }).toString()}`
      : "";
    return get<JudicialPetitionListItem[]>(`/judicial-petitions/my${qs}`);
  },
  list: (params?: { status?: JudicialPetitionStatus }) => {
    const qs = params?.status
      ? `?${new URLSearchParams({ status: params.status }).toString()}`
      : "";
    return get<JudicialPetitionListItem[]>(`/judicial-petitions${qs}`);
  },
  get: (id: string) => get<JudicialPetitionOut>(`/judicial-petitions/${id}`),
  updateStatus: (
    id: string,
    body: {
      status: JudicialPetitionStatus;
      docketing_note?: string | null;
      decision_summary?: string | null;
    },
  ) => patch<JudicialPetitionOut>(`/judicial-petitions/${id}/status`, body),
};

// ── 公文受文者 ─────────────────────────────────────────────────────────────────

export const documentsRecipientsApi = {
  update: (id: string, recipients: import("./types").RecipientCreatePayload[]) =>
    request<void>(`/documents/${id}/recipients`, {
      method: "PUT",
      body: JSON.stringify(recipients),
    }),
};

// ── 公告系統 ───────────────────────────────────────────────────────────────────

export const announcementsApi = {
  activeUrgent: () => get<AnnouncementOut | null>("/announcements/active-urgent"),
  list: (params?: { org_id?: string; activity_id?: string; skip?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.org_id) qs.set("org_id", params.org_id);
    if (params?.activity_id) qs.set("activity_id", params.activity_id);
    if (params?.skip != null) qs.set("skip", String(params.skip));
    if (params?.limit != null) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return get<AnnouncementListItem[]>(`/announcements${q ? `?${q}` : ""}`);
  },
  listAll: (params?: { org_id?: string; activity_id?: string; skip?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.org_id) qs.set("org_id", params.org_id);
    if (params?.activity_id) qs.set("activity_id", params.activity_id);
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

// ── 公開官網 / Linktree ──────────────────────────────────────────────────────

export const siteApi = {
  public: () => get<PublicSiteBundleOut>("/site/public"),
  publicLinks: () => get<PublicLinkOut[]>("/site/links"),
  publicLinkCategories: () => get<PublicLinkCategoryOut[]>("/site/link-categories"),
  publicOfficers: (active_only = true) =>
    get<PublicOfficerOut[]>(`/site/officers?active_only=${active_only}`),
  publicPages: () => get<PublicSitePageOut[]>("/site/pages"),
  publicPage: (slug: string) => get<PublicSitePageOut>(`/site/pages/${encodeURIComponent(slug)}`),

  adminSettings: () => get<PublicSiteSettingsOut>("/site/admin/settings"),
  updateSettings: (body: PublicSiteSettingsUpdate) =>
    patch<PublicSiteSettingsOut>("/site/admin/settings", body),

  uploadImage: async (file: File): Promise<UploadedImageOut> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/site/admin/images`, {
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

  adminLinkCategories: () => get<PublicLinkCategoryOut[]>("/site/admin/link-categories"),
  createLinkCategory: (body: PublicLinkCategoryCreate) =>
    post<PublicLinkCategoryOut>("/site/admin/link-categories", body),
  updateLinkCategory: (id: string, body: PublicLinkCategoryUpdate) =>
    patch<PublicLinkCategoryOut>(`/site/admin/link-categories/${encodeURIComponent(id)}`, body),
  deleteLinkCategory: (id: string) =>
    del<void>(`/site/admin/link-categories/${encodeURIComponent(id)}`),

  adminLinks: () => get<PublicLinkOut[]>("/site/admin/links"),
  createLink: (body: PublicLinkCreate) => post<PublicLinkOut>("/site/admin/links", body),
  updateLink: (id: string, body: PublicLinkUpdate) =>
    patch<PublicLinkOut>(`/site/admin/links/${encodeURIComponent(id)}`, body),
  deleteLink: (id: string) => del<void>(`/site/admin/links/${encodeURIComponent(id)}`),

  officerCandidates: (active_only = true) =>
    get<PublicOfficerCandidateOut[]>(`/site/admin/officer-candidates?active_only=${active_only}`),
  officerProfiles: () => get<PublicOfficerProfileOut[]>("/site/admin/officer-profiles"),
  createOfficerProfile: (body: PublicOfficerProfileCreate) =>
    post<PublicOfficerProfileOut>("/site/admin/officer-profiles", body),
  updateOfficerProfile: (id: string, body: PublicOfficerProfileUpdate) =>
    patch<PublicOfficerProfileOut>(`/site/admin/officer-profiles/${encodeURIComponent(id)}`, body),
  deleteOfficerProfile: (id: string) =>
    del<void>(`/site/admin/officer-profiles/${encodeURIComponent(id)}`),

  adminPages: () => get<PublicSitePageOut[]>("/site/admin/pages"),
  createPage: (body: PublicSitePageCreate) => post<PublicSitePageOut>("/site/admin/pages", body),
  updatePage: (id: string, body: PublicSitePageUpdate) =>
    patch<PublicSitePageOut>(`/site/admin/pages/${encodeURIComponent(id)}`, body),
  deletePage: (id: string) => del<void>(`/site/admin/pages/${encodeURIComponent(id)}`),
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
  insights: (limit = 20) =>
    get<AnalyticsInsightsOut>(`/analytics/insights?limit=${limit}`),
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
    mode?: MeetingMode;
    activity_id?: string | null;
    description?: string | null;
    location?: string | null;
    chair_name?: string | null;
    starts_at?: string | null;
    ends_at?: string | null;
    expected_voters?: number;
    quorum_count?: number;
    default_pass_threshold?: number;
    default_speech_seconds?: number;
    allow_observer_requests?: boolean;
    bill_stage?: MeetingBillStage | null;
  }) => post<MeetingOut>("/meetings", body),
  update: (id: string, body: Partial<{
    title: string;
    mode: MeetingMode;
    activity_id: string | null;
    description: string | null;
    location: string | null;
    chair_name: string | null;
    starts_at: string | null;
    ends_at: string | null;
    expected_voters: number;
    quorum_count: number;
    default_pass_threshold: number;
    default_speech_seconds: number;
    allow_observer_requests: boolean;
    bill_stage: MeetingBillStage | null;
    current_agenda_item_id: string | null;
    screen_focus_title: string | null;
    screen_focus_body: string | null;
  }>) => patch<MeetingOut>(`/meetings/${id}`, body),
  start: (id: string) => post<MeetingOut>(`/meetings/${id}/start`),
  openCheckIn: (id: string) => post<MeetingOut>(`/meetings/${id}/check-in/open`),
  pause: (id: string) => post<MeetingOut>(`/meetings/${id}/pause`),
  break: (id: string) => post<MeetingOut>(`/meetings/${id}/break`),
  close: (id: string) => post<MeetingOut>(`/meetings/${id}/close`),
  archive: (id: string) => post<MeetingOut>(`/meetings/${id}/archive`),
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
    threshold_type?: VoteThresholdType;
    record_method?: MeetingVoteRecordMethod;
    options?: MeetingVoteOption[] | null;
  }) => post<MeetingVoteOut>(`/meetings/${id}/votes`, body),
  updateVote: (id: string, voteId: string, body: Partial<{
    title: string;
    description: string | null;
    visibility: VoteVisibility;
    pass_threshold: number;
    threshold_type: VoteThresholdType;
    record_method: MeetingVoteRecordMethod;
    options: MeetingVoteOption[] | null;
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
    create_follow_up?: boolean;
    follow_up_assignee_id?: string | null;
    follow_up_due_at?: string | null;
    create_document_draft?: boolean;
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
  // ── 簡易評議模式 ──────────────────────────────────────────────────────────
  recorderBallot: (id: string, voteId: string, body: {
    voter_id: string;
    choice?: BallotChoice;
    option_key?: string | null;
  }) => post<MeetingBallotOut>(`/meetings/${id}/votes/${voteId}/recorder-ballot`, body),
  recordTally: (id: string, voteId: string, body: {
    manual_tally: Record<string, number>;
    result_label?: string | null;
  }) => post<MeetingVoteOut>(`/meetings/${id}/votes/${voteId}/tally`, body),
  acclamation: (id: string, agendaItemId: string, body?: {
    title?: string | null;
    result_label?: string;
  }) => post<MeetingVoteOut>(`/meetings/${id}/agenda-items/${agendaItemId}/acclamation`, body ?? {}),
  addRecusal: (id: string, agendaItemId: string, body: { user_id: string; note?: string | null }) =>
    post<MeetingAgendaItemOut>(`/meetings/${id}/agenda-items/${agendaItemId}/recusals`, body),
  removeRecusal: (id: string, agendaItemId: string, userId: string) =>
    del<MeetingAgendaItemOut>(`/meetings/${id}/agenda-items/${agendaItemId}/recusals/${userId}`),
  createRequest: (id: string, body: {
    request_type: MeetingRequestType;
    agenda_item_id?: string | null;
    content?: string | null;
  }) => post<MeetingRequestOut>(`/meetings/${id}/requests`, body),
  updateRequest: (id: string, requestId: string, status: MeetingRequestStatus) =>
    patch<MeetingRequestOut>(`/meetings/${id}/requests/${requestId}`, { status }),
  enqueueRequest: (id: string, requestId: string) =>
    post<MeetingSpeechQueueItemOut>(`/meetings/${id}/requests/${requestId}/enqueue`),
  createSpeechQueueItem: (id: string, body: {
    agenda_item_id?: string | null;
    user_id?: string | null;
    request_id?: string | null;
    speaker_name?: string | null;
    speaker_role?: string | null;
    duration_seconds?: number | null;
  }) => post<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue`, body),
  reorderSpeechQueue: (id: string, ordered_ids: string[]) =>
    patch<MeetingSpeechQueueItemOut[]>(`/meetings/${id}/speech-queue/reorder`, { ordered_ids }),
  updateSpeechQueueItem: (id: string, speechId: string, body: Partial<{
    agenda_item_id: string | null;
    speaker_name: string;
    speaker_role: string | null;
    status: MeetingSpeechQueueStatus;
    order_index: number;
    duration_seconds: number;
    remaining_seconds: number;
  }>) => patch<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue/${speechId}`, body),
  startSpeech: (id: string, speechId: string) =>
    post<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue/${speechId}/start`),
  pauseSpeech: (id: string, speechId: string) =>
    post<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue/${speechId}/pause`),
  resumeSpeech: (id: string, speechId: string) =>
    post<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue/${speechId}/resume`),
  finishSpeech: (id: string, speechId: string) =>
    post<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue/${speechId}/finish`),
  skipSpeech: (id: string, speechId: string) =>
    post<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue/${speechId}/skip`),
  extendSpeech: (id: string, speechId: string, seconds: number) =>
    post<MeetingSpeechQueueItemOut>(`/meetings/${id}/speech-queue/${speechId}/extend`, { seconds }),
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

// ── 行事曆 ────────────────────────────────────────────────────────────────────

export const calendarApi = {
  list: (params?: {
    start?: string;
    end?: string;
    org_id?: string;
    type?: CalendarEventType;
    visibility?: CalendarVisibility;
    mine?: boolean;
  }) => {
    const q = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") q.set(key, String(value));
    });
    const qs = q.toString();
    return get<CalendarEventListItem[]>(`/calendar/events${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => get<CalendarEventOut>(`/calendar/events/${id}`),
  create: (body: CalendarEventCreate) => post<CalendarEventOut>("/calendar/events", body),
  update: (id: string, body: Partial<CalendarEventCreate>) =>
    patch<CalendarEventOut>(`/calendar/events/${id}`, body),
  delete: (id: string) => del<void>(`/calendar/events/${id}`),
  upsertParticipant: (
    id: string,
    body: {
      user_id: string;
      role?: CalendarParticipantRole;
      response?: CalendarParticipantResponse;
    },
  ) => post<CalendarParticipantOut>(`/calendar/events/${id}/participants`, body),
  updateParticipant: (
    id: string,
    participantId: string,
    body: Partial<{ role: CalendarParticipantRole; response: CalendarParticipantResponse }>,
  ) => patch<CalendarParticipantOut>(
    `/calendar/events/${id}/participants/${participantId}`,
    body,
  ),
  deleteParticipant: (id: string, participantId: string) =>
    del<void>(`/calendar/events/${id}/participants/${participantId}`),
  createChecklistItem: (id: string, body: CalendarChecklistCreate) =>
    post<CalendarChecklistOut>(`/calendar/events/${id}/checklist`, body),
  updateChecklistItem: (
    id: string,
    itemId: string,
    body: Partial<CalendarChecklistCreate & { is_done: boolean }>,
  ) => patch<CalendarChecklistOut>(`/calendar/events/${id}/checklist/${itemId}`, body),
  deleteChecklistItem: (id: string, itemId: string) =>
    del<void>(`/calendar/events/${id}/checklist/${itemId}`),
  createLink: (id: string, body: CalendarLinkCreate) =>
    post<CalendarLinkOut>(`/calendar/events/${id}/links`, body),
  deleteLink: (id: string, linkId: string) =>
    del<void>(`/calendar/events/${id}/links/${linkId}`),
};

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

// ── 儀表板 / 待辦中心 ─────────────────────────────────────────────────────────

export type DashboardSeverity = "info" | "warning" | "critical";
export type DashboardLayoutHint = "student" | "officer" | "leader";

export interface DashboardWidgetItem {
  title: string;
  subtitle: string | null;
  href: string | null;
  timestamp: string | null;
  badge: string | null;
  priority_score: number;
  priority_reasons: string[];
  recommended_action: string | null;
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
  priority_score: number;
  priority_reasons: string[];
  recommended_action: string | null;
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
  | "meal" | "shop" | "survey" | "announcement" | "calendar" | "work_item";

export type TaskAction =
  | "approve" | "attend" | "review" | "publish"
  | "reply" | "fill" | "collect" | "pickup" | "sign"
  | "complete" | "prepare" | "manage";

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
  priority_score: number;
  priority_reasons: string[];
  recommended_action: string | null;
}

export interface TaskInboxResponse {
  items: TaskItem[];
  total: number;
  by_module: Record<string, number>;
}

export interface TaskCountResponse {
  total: number;
  by_module: Record<string, number>;
  urgent_count: number;
}

export const tasksApi = {
  list: () => get<TaskInboxResponse>("/tasks"),
  count: () => get<TaskCountResponse>("/tasks/count"),
};

// ── 段考題庫 ────────────────────────────────────────────────────────────────

export const examPapersApi = {
  list: (params?: {
    include_unpublished?: boolean;
    subject?: string;
    academic_year?: number;
    semester?: number;
    grade?: number;
    grade_track?: ExamGradeTrack | null;
    exam_number?: number;
  }) => {
    const q = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") q.set(key, String(value));
    });
    const qs = q.toString();
    return get<ExamPaperListItem[]>(`/exam-papers${qs ? `?${qs}` : ""}`);
  },
  create: async (body: {
    file: File;
    title: string;
    subject: string;
    academic_year: number;
    semester: number;
    grade: number;
    grade_track?: ExamGradeTrack | null;
    exam_number: number;
    is_published: boolean;
  }): Promise<ExamPaperOut> => {
    const fd = new FormData();
    fd.append("file", body.file);
    fd.append("title", body.title);
    fd.append("subject", body.subject);
    fd.append("academic_year", String(body.academic_year));
    fd.append("semester", String(body.semester));
    fd.append("grade", String(body.grade));
    if (body.grade_track) fd.append("grade_track", body.grade_track);
    fd.append("exam_number", String(body.exam_number));
    fd.append("is_published", String(body.is_published));
    const doFetch = () =>
      fetch(`${BASE}/exam-papers`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      });
    let res = await doFetch();
    if (res.status === 401 && await silentRefresh()) res = await doFetch();
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.json();
  },
  update: (id: string, body: ExamPaperUpdate) => patch<ExamPaperOut>(`/exam-papers/${id}`, body),
  delete: (id: string) => del<void>(`/exam-papers/${id}`),
  downloadUrl: (id: string) => `${BASE}/exam-papers/${id}/download`,
  downloads: (id: string) => get<ExamPaperDownloadOut[]>(`/exam-papers/${id}/downloads`),
  inspectTrace: async (file: File): Promise<ExamTraceInspectOut> => {
    const fd = new FormData();
    fd.append("file", file);
    const doFetch = () =>
      fetch(`${BASE}/exam-papers/trace/inspect`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders("POST"),
        body: fd,
      });
    let res = await doFetch();
    if (res.status === 401 && await silentRefresh()) res = await doFetch();
    if (!res.ok) throw new ApiError(res.status, await errorMessageFromResponse(res));
    return res.json();
  },
};

// ── 管理員系統狀態（admin/system） ───────────────────────────────────────────

export interface DbPoolView {
  size: number;
  checked_in: number;
  checked_out: number;
  overflow: number;
  utilization: number;
}

export interface WsLimits {
  global_max: number;
  per_ip_max: number;
  per_room_max: number;
}

export interface WsRoomCount {
  room: string;
  connections: number;
}

export interface WsView {
  total: number;
  rooms: number;
  unique_ips: number;
  per_room: WsRoomCount[];
  limits: WsLimits;
}

export interface CeleryQueueView {
  name: string;
  active: number;
  reserved: number;
}

export interface CeleryView {
  queues: CeleryQueueView[];
  error: string | null;
}

export interface RedisView {
  connected_clients: number;
  blocked_clients: number;
  error: string | null;
}

export interface LoadSignalsView {
  active_requests: number;
  recent_5xx_ratio: number;
  recent_5xx_count: number;
  window_seconds: number;
}

export interface MaintenanceView {
  enabled: boolean;
  message: string;
  until: number | null;
}

export type LoadShedMode = "off" | "auto" | "on" | "bypass";

export interface SystemMetricsSnapshot {
  timestamp: number;
  db_pool: DbPoolView;
  redis: RedisView;
  ws: WsView;
  celery: CeleryView;
  load_signals: LoadSignalsView;
  maintenance: MaintenanceView;
  load_shed_mode: LoadShedMode;
}

export interface SystemFeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
}

export type ModuleSeverity = "CRITICAL" | "HIGH" | "NORMAL";

export interface ModuleStatus {
  id: string;
  label: string;
  on: boolean;
  mode: "maintenance" | "closed";
  source: "manual" | "auto" | null;
  reason: string;
  since: number | null;
  until: number | null;
  recent_5xx_count: number;
  severity_breakdown: Record<string, number>;
  trip_count: number;
  max_severity: ModuleSeverity;
}

export interface ModuleRecoverResult {
  module_id: string;
  recovered: boolean;
  probe_ok: boolean;
  probe_reason: string;
}

export interface ModuleTripHistory {
  module_id: string;
  trip_count: number;
  max_severity: ModuleSeverity;
  recent_5xx_count: number;
  severity_breakdown: Record<string, number>;
  recent_events: Array<{
    timestamp: number;
    severity: ModuleSeverity;
    trip_count: number;
    cooldown_s: number;
    escalated: boolean;
  }>;
}

export interface ModuleStatusPublic {
  id: string;
  label: string;
  on: boolean;
  mode: "maintenance" | "closed";
  reason: string;
  until: number | null;
}

export interface AppSettingField {
  key: string;
  category: string;
  type: "bool" | "number" | "list" | "string";
  is_secret: boolean;
  in_file: boolean;
  value: string;
  description: string;
}

export interface AppSettingsListResponse {
  enabled: boolean;
  mfa_enabled: boolean;
  env_path: string;
  fields: AppSettingField[];
}

export interface IpBlockedItem {
  ip: string;
  reason: string;
  expires_at: number | null;
}

export type DefenseRuleType =
  | "ip_block"
  | "cidr_block"
  | "ip_allow"
  | "rate_limit_override"
  | "endpoint_lockdown"
  | "bot_challenge_placeholder";

export interface DefenseRule {
  id: string;
  rule_type: DefenseRuleType;
  target: string;
  is_active: boolean;
  reason: string;
  config: Record<string, unknown>;
  expires_at: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DefenseRuleCreate {
  rule_type: DefenseRuleType;
  target: string;
  reason?: string;
  config?: Record<string, unknown>;
  expires_at?: string | null;
}

export interface DefenseRuleUpdate {
  rule_type?: DefenseRuleType;
  target?: string;
  is_active?: boolean;
  reason?: string;
  config?: Record<string, unknown>;
  expires_at?: string | null;
}

export interface RateLimitOverride {
  path_prefix: string;
  requests: number;
  window_seconds: number;
}

export interface RateLimitConfig {
  enabled: boolean;
  global_requests: number;
  global_window_seconds: number;
  overrides: RateLimitOverride[];
}

export interface DefenseSummary {
  active_rule_count: number;
  total_rule_count: number;
  active_by_type: Record<string, number>;
  active_rules: DefenseRule[];
  rate_limit: RateLimitConfig;
  recent_status_counts: Record<string, number>;
}

export type ErrorCategory = "db" | "redis" | "timeout" | "http" | "unhandled";

export interface RecentErrorItem {
  error_id: string;
  request_id?: string | null;
  client_ip?: string | null;
  user_agent?: string | null;
  category: ErrorCategory;
  exc_type: string;
  message: string;
  method: string;
  path: string;
  status_code: number;
  traceback_head: string;
  first_seen: number;
  last_seen: number;
  occurrences: number;
  source?: string;
}

export interface RecentErrorsResponse {
  count: number;
  items: RecentErrorItem[];
}

export interface DeadLetterItem {
  timestamp?: string | null;
  status?: string | null;
  task?: string | null;
  task_id?: string | null;
  queue?: string | null;
  retries?: number | null;
  exception_type?: string | null;
  exception?: string | null;
  args?: string[];
  kwargs?: Record<string, string>;
}

export interface DeadLetterResponse {
  key: string;
  items: DeadLetterItem[];
}

export interface DbUpgradeResult {
  ok: boolean;
  error?: string;
  before_revision?: string | null;
  head_revision?: string | null;
  changed?: boolean;
}

export interface SystemDiagnostics {
  timestamp: number;
  version: string;
  uptime_seconds: number;
  db: { ok: boolean; detail?: string | null };
  redis: { ok: boolean; detail?: string | null };
  celery: { ok: boolean; detail?: string | null };
  workers: { name: string; active: number; reserved: number }[];
  queue_depths: { name: string; pending: number }[];
  email_queue_pending: number;
  email_outbox: Record<string, number>;
  ws: WsView;
}

export const systemApi = {
  status: () => get<SystemMetricsSnapshot>("/admin/system/status"),
  defenseSummary: () => get<DefenseSummary>("/admin/system/defense/summary"),
  listDefenseRules: (params?: { active_only?: boolean; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.active_only !== undefined) q.set("active_only", String(params.active_only));
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<DefenseRule[]>(`/admin/system/defense/rules${qs ? `?${qs}` : ""}`);
  },
  createDefenseRule: (body: DefenseRuleCreate) =>
    post<DefenseRule>("/admin/system/defense/rules", body),
  updateDefenseRule: (id: string, body: DefenseRuleUpdate) =>
    patch<DefenseRule>(`/admin/system/defense/rules/${encodeURIComponent(id)}`, body),
  deactivateDefenseRule: (id: string) =>
    del<DefenseRule>(`/admin/system/defense/rules/${encodeURIComponent(id)}`),
  rateLimit: () => get<RateLimitConfig>("/admin/system/rate-limit"),
  setRateLimit: (body: RateLimitConfig) => put<RateLimitConfig>("/admin/system/rate-limit", body),
  maintenance: () => get<MaintenanceView>("/admin/system/maintenance"),
  setMaintenance: (body: { enabled: boolean; message?: string; until?: number | null }) =>
    put<MaintenanceView>("/admin/system/maintenance", body),
  listFeatureFlags: () => get<SystemFeatureFlag[]>("/admin/system/feature-flags"),
  setFeatureFlag: (key: string, enabled: boolean) =>
    patch<SystemFeatureFlag>(`/admin/system/feature-flags/${encodeURIComponent(key)}`, { enabled }),
  setLoadShedMode: (mode: LoadShedMode) =>
    put<{ mode: LoadShedMode }>("/admin/system/load-shed", { mode }),
  moduleStatuses: () => get<ModuleStatusPublic[]>("/system/module-status"),
  diagnostics: () => get<SystemDiagnostics>("/admin/system/diagnostics"),
  listModules: () => get<ModuleStatus[]>("/admin/system/modules"),
  setModuleMaintenance: (
    id: string,
    body: { on: boolean; mode?: "maintenance" | "closed"; reason?: string },
  ) =>
    put<ModuleStatus>(`/admin/system/modules/${encodeURIComponent(id)}/maintenance`, body),
  restartModule: (id: string) =>
    post<{ ok: boolean; module: string }>(
      `/admin/system/modules/${encodeURIComponent(id)}/restart`,
      {},
    ),
  recoverModule: (id: string) =>
    post<ModuleRecoverResult>(
      `/admin/system/modules/${encodeURIComponent(id)}/recover`,
      {},
    ),
  moduleTripHistory: (id: string) =>
    get<ModuleTripHistory>(`/admin/system/modules/${encodeURIComponent(id)}/trip-history`),
  listAppSettings: () => get<AppSettingsListResponse>("/admin/system/settings"),
  revealAppSettings: (mfa_code: string, keys: string[]) =>
    post<{ values: Record<string, string> }>("/admin/system/settings/reveal", {
      mfa_code,
      keys,
    }),
  saveAppSettings: (mfa_code: string, changes: Record<string, string>) =>
    put<{ updated: string[]; restart_required: boolean }>("/admin/system/settings", {
      mfa_code,
      changes,
    }),
  listIpBlocks: () => get<IpBlockedItem[]>("/admin/system/ip-blocklist"),
  addIpBlock: (body: { ip: string; reason?: string; ttl_seconds?: number | null }) =>
    post<IpBlockedItem>("/admin/system/ip-blocklist", body),
  removeIpBlock: (ip: string) =>
    del<{ ip: string; removed: boolean }>(`/admin/system/ip-blocklist/${encodeURIComponent(ip)}`),
  revokeUserTokens: (user_id: string) =>
    post<{ user_id: string; revoked_count: number }>("/admin/system/revoke-user-tokens", { user_id }),
  wsRooms: () =>
    get<{
      stats: { total: number; rooms: number; unique_ips: number; limits: WsLimits };
      rooms: WsRoomCount[];
      ips: { ip: string; connections: number }[];
    }>("/admin/system/ws/rooms"),
  slowQueries: (top = 10) =>
    get<{
      top: number;
      items: Array<{ template: string; max_ms: number; occurrences: number; last_seen: number }>;
    }>(`/admin/system/metrics/slow-queries?top=${top}`),
  recentErrors: (top = 50) =>
    get<RecentErrorsResponse>(`/admin/system/errors?top=${top}`),
  errorById: (errorId: string) =>
    get<RecentErrorItem>(`/admin/system/errors/${encodeURIComponent(errorId)}`),
  clearErrors: () => post<{ cleared: number }>("/admin/system/errors/clear", {}),
  deadLetters: (limit = 50) =>
    get<DeadLetterResponse>(`/admin/system/dead-letters?limit=${limit}`),
  clearDeadLetters: () =>
    del<{ cleared: boolean; key: string }>("/admin/system/dead-letters"),
  clearCache: () =>
    post<{ ok: boolean; cleared: number; patterns: string[] }>(
      "/admin/system/recovery/clear-cache",
      {},
    ),
  dbUpgrade: () => post<DbUpgradeResult>("/admin/system/recovery/db-upgrade", {}),
  restartService: () =>
    post<{ scheduled: boolean; environment: string }>("/admin/system/recovery/restart", {}),
};

// ── 資料生命週期（archive + purge）────────────────────────────────────────
export type LifecycleAction = "archive" | "purge" | "archive_then_purge";

export interface LifecycleRuleSummary {
  id: string;
  label: string;
  description: string;
  default_retention_days: number;
  min_retention_days: number;
  default_action: LifecycleAction;
  danger_level: "safe" | "caution" | "dangerous";
  extra_filter: string | null;
  affects_modules: string[];
  matched_count: number;
}

export interface LifecyclePreviewResult {
  rule_id: string;
  retention_days: number;
  cutoff_at: string;
  matched_count: number;
  sample: Array<Record<string, unknown>>;
}

export interface LifecycleExecuteResult {
  rule_id: string;
  action: LifecycleAction;
  retention_days: number;
  cutoff_at: string;
  matched_count: number;
  archived_count: number;
  purged_count: number;
  archive_file: string | null;
  started_at: string;
  finished_at: string;
}

export interface LifecycleArchiveFile {
  path: string;
  size_bytes: number;
  modified_at: string;
}

export const lifecycleApi = {
  listRules: () => get<LifecycleRuleSummary[]>("/admin/lifecycle/rules"),
  preview: (rule_id: string, retention_days?: number) =>
    post<LifecyclePreviewResult>(
      `/admin/lifecycle/rules/${encodeURIComponent(rule_id)}/preview`,
      { retention_days: retention_days ?? null },
    ),
  execute: (
    rule_id: string,
    body: {
      action?: LifecycleAction;
      retention_days?: number;
      batch_size?: number;
      max_batches?: number;
    },
  ) =>
    post<LifecycleExecuteResult>(
      `/admin/lifecycle/rules/${encodeURIComponent(rule_id)}/execute`,
      body,
    ),
  listArchives: () => get<LifecycleArchiveFile[]>("/admin/lifecycle/archives"),
  previewArchive: (path: string, limit = 50) =>
    get<Array<Record<string, unknown>>>(
      `/admin/lifecycle/archives/preview?path=${encodeURIComponent(path)}&limit=${limit}`,
    ),
  archiveDownloadUrl: (path: string) =>
    `/admin/lifecycle/archives/download?path=${encodeURIComponent(path)}`,
};

// ── 誤刪救援（trash MVP）─────────────────────────────────────────────────
export interface TrashEntry {
  audit_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  created_at: string;
  summary: string | null;
  meta: Record<string, unknown>;
}

export const trashApi = {
  list: (params?: { days?: number; entity_type?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.days !== undefined) q.set("days", String(params.days));
    if (params?.entity_type) q.set("entity_type", params.entity_type);
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return get<TrashEntry[]>(`/admin/trash${qs ? `?${qs}` : ""}`);
  },
  detail: (audit_id: string) =>
    get<TrashEntry>(`/admin/trash/${encodeURIComponent(audit_id)}`),
};

// ── 個資處理（export + anonymize）────────────────────────────────────────
export interface PrivacyExportResult {
  user_id: string;
  file_path: string;
  size_bytes: number;
  file_count: number;
  generated_at: string;
}

export interface PrivacyExportFile {
  filename: string;
  size_bytes: number;
  modified_at: string;
}

export interface PrivacyAnonymizeResult {
  user_id: string;
  fields_updated: string[];
  anonymized_at: string;
}

export const privacyApi = {
  exportUser: (user_id: string) =>
    post<PrivacyExportResult>(
      `/admin/privacy/users/${encodeURIComponent(user_id)}/export`,
      {},
    ),
  anonymizeUser: (user_id: string, confirm_phrase: string) =>
    post<PrivacyAnonymizeResult>(
      `/admin/privacy/users/${encodeURIComponent(user_id)}/anonymize`,
      { confirm_phrase },
    ),
  listExports: () => get<PrivacyExportFile[]>("/admin/privacy/exports"),
  exportDownloadUrl: (filename: string) =>
    `/admin/privacy/exports/download?filename=${encodeURIComponent(filename)}`,
};

// ── 換屆精靈 ────────────────────────────────────────────────────────────
export interface NewAssignmentIn {
  user_id: string;
  position_id: string;
  start_date: string; // ISO date
  end_date?: string | null;
}

export interface DryRunBody {
  new_term_start: string;
  new_assignments: NewAssignmentIn[];
  terminate_active_before: boolean;
}

export interface TerminationOut {
  user_position_id: string;
  user_id: string;
  user_email: string | null;
  position_id: string;
  position_name: string;
  org_name: string;
  current_end_date: string | null;
  new_end_date: string;
}

export interface SeatAssignmentOut {
  user_id: string;
  user_email: string | null;
  position_id: string;
  position_name: string;
  org_name: string;
  start_date: string;
  end_date: string | null;
  warning: string | null;
}

export interface DryRunOut {
  new_term_start: string;
  terminations: TerminationOut[];
  new_assignments: SeatAssignmentOut[];
  warnings: string[];
  summary: Record<string, number>;
}

export interface ExecuteRolloverOut {
  batch_id: string;
  terminated_count: number;
  created_count: number;
  started_at: string;
  finished_at: string;
}

export interface RollbackOut {
  batch_id: string;
  restored_terminations: number;
  deleted_new_assignments: number;
}

export const termRolloverApi = {
  dryRun: (body: DryRunBody) => post<DryRunOut>("/admin/term-rollover/dry-run", body),
  execute: (body: DryRunBody, confirm_phrase: string) =>
    post<ExecuteRolloverOut>("/admin/term-rollover/execute", { ...body, confirm_phrase }),
  rollback: (batch_id: string, confirm_phrase: string) =>
    post<RollbackOut>(
      `/admin/term-rollover/rollback/${encodeURIComponent(batch_id)}`,
      { confirm_phrase },
    ),
};

// ── 學籍異動 ────────────────────────────────────────────────────────────
export interface LifecycleStatus {
  user_id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  active_positions: Array<{
    user_position_id: string;
    position_id: string;
    start_date: string;
    end_date: string | null;
  }>;
}

export interface LifecycleActionResult {
  user_id: string;
  action: string;
  affected_positions: number;
  was_active: boolean;
  performed_at: string;
}

export const userLifecycleApi = {
  status: (user_id: string) =>
    get<LifecycleStatus>(`/admin/users/${encodeURIComponent(user_id)}/lifecycle/status`),
  freeze: (user_id: string, reason: string) =>
    post<LifecycleActionResult>(
      `/admin/users/${encodeURIComponent(user_id)}/lifecycle/freeze`,
      { reason },
    ),
  archiveAlumni: (user_id: string, reason: string) =>
    post<LifecycleActionResult>(
      `/admin/users/${encodeURIComponent(user_id)}/lifecycle/archive-alumni`,
      { reason },
    ),
  restore: (user_id: string, reason: string) =>
    post<LifecycleActionResult>(
      `/admin/users/${encodeURIComponent(user_id)}/lifecycle/restore`,
      { reason },
    ),
};

// ── 預寫報表 ────────────────────────────────────────────────────────────
export interface ReportSummary {
  id: string;
  label: string;
  description: string;
}

export interface ReportResult {
  id: string;
  label: string;
  rows: Array<Record<string, unknown>>;
  row_count: number;
}

export const reportsApi = {
  list: () => get<ReportSummary[]>("/admin/reports"),
  run: (id: string) => get<ReportResult>(`/admin/reports/${encodeURIComponent(id)}`),
  csvUrl: (id: string) => `/admin/reports/${encodeURIComponent(id)}/csv`,
};

// ── Feature Flags（後台）─────────────────────────────────────────────────
export interface FeatureFlagOut {
  id: string;
  key: string;
  description: string | null;
  is_globally_enabled: boolean;
  percentage_rollout: number;
  enabled_user_ids: string[];
  enabled_permission_codes: string[];
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeatureFlagCreate {
  key: string;
  description?: string | null;
}

export interface FeatureFlagUpdate {
  description?: string | null;
  is_globally_enabled?: boolean;
  percentage_rollout?: number;
  enabled_user_ids?: string[];
  enabled_permission_codes?: string[];
}

export const featureFlagsApi = {
  list: () => get<FeatureFlagOut[]>("/feature-flags"),
  create: (body: FeatureFlagCreate) => post<FeatureFlagOut>("/feature-flags", body),
  update: (id: string, body: FeatureFlagUpdate) =>
    patch<FeatureFlagOut>(`/feature-flags/${encodeURIComponent(id)}`, body),
  archive: (id: string) =>
    post<FeatureFlagOut>(`/feature-flags/${encodeURIComponent(id)}/archive`, {}),
};

// ── API Keys ─────────────────────────────────────────────────────────────
export interface ApiKeyOut {
  id: string;
  name: string;
  key_prefix: string;
  owner_user_id: string;
  scopes: string[];
  rate_limit_per_minute: number;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ApiKeyCreate {
  name: string;
  scopes?: string[];
  rate_limit_per_minute?: number;
  expires_at?: string | null;
}

export interface ApiKeyCreatedResponse {
  api_key: ApiKeyOut;
  key_plaintext: string;
}

export const apiKeysApi = {
  list: (include_revoked = false) =>
    get<ApiKeyOut[]>(`/api-keys?include_revoked=${include_revoked}`),
  create: (body: ApiKeyCreate) => post<ApiKeyCreatedResponse>("/api-keys", body),
  detail: (id: string) => get<ApiKeyOut>(`/api-keys/${encodeURIComponent(id)}`),
  revoke: (id: string, reason: string) =>
    post<ApiKeyOut>(`/api-keys/${encodeURIComponent(id)}/revoke`, { reason }),
};

// ── Webhooks ─────────────────────────────────────────────────────────────
export interface WebhookSubscriptionOut {
  id: string;
  name: string;
  owner_user_id: string;
  url: string;
  events: string[];
  is_active: boolean;
  max_retries: number;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookSubscriptionCreate {
  name: string;
  url: string;
  events: string[];
  description?: string | null;
  max_retries?: number;
}

export interface WebhookSubscriptionUpdate {
  name?: string;
  url?: string;
  events?: string[];
  description?: string | null;
  is_active?: boolean;
  max_retries?: number;
}

export interface WebhookSubscriptionCreatedResponse {
  subscription: WebhookSubscriptionOut;
  signing_secret: string;
}

export interface WebhookDeliveryOut {
  id: string;
  subscription_id: string;
  event_type: string;
  status: string;
  attempt_count: number;
  scheduled_at: string;
  last_attempted_at: string | null;
  succeeded_at: string | null;
  response_status: number | null;
  error_message: string | null;
  created_at: string;
}

export const webhooksApi = {
  list: (only_active = false) =>
    get<WebhookSubscriptionOut[]>(`/webhooks?only_active=${only_active}`),
  create: (body: WebhookSubscriptionCreate) =>
    post<WebhookSubscriptionCreatedResponse>("/webhooks", body),
  update: (id: string, body: WebhookSubscriptionUpdate) =>
    patch<WebhookSubscriptionOut>(`/webhooks/${encodeURIComponent(id)}`, body),
  remove: (id: string) => del<{ ok: boolean }>(`/webhooks/${encodeURIComponent(id)}`),
  deliveries: (id: string, limit = 50) =>
    get<WebhookDeliveryOut[]>(
      `/webhooks/${encodeURIComponent(id)}/deliveries?limit=${limit}`,
    ),
};

// ── 政策（隱私 / ToS / Cookie / 無障礙）───────────────────────────────
export type PolicyKind =
  | "privacy"
  | "terms"
  | "cookie"
  | "accessibility"
  | "security";
export type PrivacyRequestType =
  | "access"
  | "rectification"
  | "erasure"
  | "objection"
  | "copy_export"
  | "other";
export type PrivacyRequestStatus =
  | "received"
  | "in_review"
  | "fulfilled"
  | "rejected"
  | "cancelled";

export interface PolicyDocumentListItem {
  id: string;
  kind: PolicyKind;
  version: string;
  title: string;
  effective_at: string;
  is_active: boolean;
}

export interface PolicyDocumentOut extends PolicyDocumentListItem {
  content_md: string;
  summary_md: string | null;
  requires_explicit_consent: boolean;
  published_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PolicyDocumentCreate {
  kind: PolicyKind;
  version: string;
  title: string;
  content_md: string;
  summary_md?: string | null;
  effective_at: string;
  requires_explicit_consent?: boolean;
}

export interface PolicyDocumentUpdate {
  title?: string;
  content_md?: string;
  summary_md?: string | null;
  effective_at?: string;
  requires_explicit_consent?: boolean;
}

export interface PrivacyRequestOut {
  id: string;
  user_id: string;
  request_type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  subject: string;
  description: string;
  submitted_ip_address: string | null;
  submitted_user_agent: string | null;
  response_message: string | null;
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
  updated_at: string;
}

export const policiesApi = {
  list: (kind?: PolicyKind) =>
    get<PolicyDocumentListItem[]>(
      kind ? `/policies?kind=${encodeURIComponent(kind)}` : "/policies",
    ),
  // 後端僅在 /policies/public/{kind}/{version} 提供 full document；用此路徑取詳情。
  detail: (kind: PolicyKind, version: string) =>
    get<PolicyDocumentOut>(
      `/policies/public/${encodeURIComponent(kind)}/${encodeURIComponent(version)}`,
    ),
  version: (kind: PolicyKind, version: string) =>
    get<PolicyDocumentOut>(
      `/policies/public/${encodeURIComponent(kind)}/${encodeURIComponent(version)}`,
    ),
  active: (kind: PolicyKind) =>
    get<PolicyDocumentOut>(`/policies/public/${encodeURIComponent(kind)}`),
  create: (body: PolicyDocumentCreate) => post<PolicyDocumentOut>("/policies", body),
  update: (id: string, body: PolicyDocumentUpdate) =>
    patch<PolicyDocumentOut>(`/policies/${encodeURIComponent(id)}`, body),
  activate: (id: string) =>
    post<PolicyDocumentOut>(`/policies/${encodeURIComponent(id)}/activate`, {}),
  listPrivacyRequests: () => get<PrivacyRequestOut[]>("/policies/privacy-requests"),
  updatePrivacyRequest: (
    id: string,
    body: { status: PrivacyRequestStatus; response_message?: string | null },
  ) =>
    patch<PrivacyRequestOut>(
      `/policies/privacy-requests/${encodeURIComponent(id)}`,
      body,
    ),
  pendingConsents: () => get<PendingConsentItem[]>("/policies/me/pending"),
  consent: (policy_document_id: string) =>
    post<PolicyConsentOut>("/policies/me/consents", { policy_document_id }),
  myConsents: () => get<PolicyConsentOut[]>("/policies/me/consents"),
};

// ── Impersonation ────────────────────────────────────────────────────────
export interface ImpersonationStartResponse {
  token: string;
  expires_in_minutes: number;
  target_user_id: string;
  target_email: string;
}

export const impersonationApi = {
  start: (target_user_id: string, minutes: number) =>
    post<ImpersonationStartResponse>(
      `/admin/impersonate/${encodeURIComponent(target_user_id)}`,
      { minutes },
    ),
  end: (token: string, reason: string) =>
    post<void>("/admin/impersonate/end", { token, reason }),
};

// ── 個資請求（policies 已合併到上方 policiesApi） ───────────────────────

export const privacyRequestsApi = {
  listMine: () => get<PrivacyRequestOut[]>("/policies/me/privacy-requests"),
  create: (body: {
    request_type: PrivacyRequestType;
    subject: string;
    description: string;
  }) => post<PrivacyRequestOut>("/policies/me/privacy-requests", body),
  cancelMine: (id: string, reason?: string | null) =>
    post<PrivacyRequestOut>(
      `/policies/me/privacy-requests/${id}/cancel`,
      { reason: reason ?? null },
    ),
  listAdmin: () => get<PrivacyRequestOut[]>("/policies/privacy-requests"),
  updateAdmin: (
    id: string,
    body: { status: PrivacyRequestStatus; response_message?: string | null },
  ) => patch<PrivacyRequestOut>(`/policies/privacy-requests/${id}`, body),
};

// ── 物品借用系統 ───────────────────────────────────────────────────────────────

export const loansApi = {
  listItems: () => get<LoanItemOut[]>("/loans/items"),
  createItem: (body: LoanItemCreate) => post<LoanItemOut>("/loans/items", body),
  updateItem: (id: string, body: LoanItemUpdate) =>
    patch<LoanItemOut>(`/loans/items/${id}`, body),
  deleteItem: (id: string) => del<void>(`/loans/items/${id}`),

  listUnits: (itemId: string) => get<LoanUnitOut[]>(`/loans/items/${itemId}/units`),
  addUnits: (itemId: string, unitCodes: string[]) =>
    post<LoanUnitOut[]>(`/loans/items/${itemId}/units`, { unit_codes: unitCodes }),
  updateUnit: (id: string, body: LoanUnitUpdate) =>
    patch<LoanUnitOut>(`/loans/units/${id}`, body),

  availableItems: () => get<LoanAvailableItem[]>("/loans/items/available"),

  checkout: (body: LoanCheckoutCreate) =>
    post<LoanRecordOut>("/loans/checkout", body),
  returnItem: (id: string) =>
    post<LoanRecordOut>(`/loans/records/${id}/return`, {}),

  listRecords: (params?: {
    status?: LoanRecordStatus;
    item_id?: string;
    keyword?: string;
    limit?: number;
  }) => {
    const qs = params
      ? "?" +
        new URLSearchParams(
          Object.fromEntries(
            Object.entries(params)
              .filter(([, v]) => v != null)
              .map(([k, v]) => [k, String(v)]),
          ),
        ).toString()
      : "";
    return get<LoanRecordOut[]>(`/loans/records${qs}`);
  },
  updateRecord: (id: string, body: LoanRecordUpdate) =>
    patch<LoanRecordOut>(`/loans/records/${id}`, body),

  dashboard: () => get<LoanDashboard>("/loans/dashboard"),
};

// ── 物資管理系統 ───────────────────────────────────────────────────────────────

function buildQs(params: Record<string, string | boolean | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

export const inventoryApi = {
  // 類別
  listCategories: () => get<InventoryCategoryOut[]>("/inventory/categories"),
  createCategory: (body: InventoryCategoryCreate) =>
    post<InventoryCategoryOut>("/inventory/categories", body),
  updateCategory: (id: string, body: InventoryCategoryUpdate) =>
    patch<InventoryCategoryOut>(`/inventory/categories/${id}`, body),
  deleteCategory: (id: string) => del<void>(`/inventory/categories/${id}`),

  // 品項
  listItems: (params?: {
    category_id?: string;
    item_type?: InventoryItemType;
    low_stock_only?: boolean;
    keyword?: string;
    include_inactive?: boolean;
  }) => get<InventoryItemOut[]>(`/inventory/items${buildQs(params ?? {})}`),
  createItem: (body: InventoryItemCreate) =>
    post<InventoryItemOut>("/inventory/items", body),
  getItem: (id: string) => get<InventoryItemOut>(`/inventory/items/${id}`),
  updateItem: (id: string, body: InventoryItemUpdate) =>
    patch<InventoryItemOut>(`/inventory/items/${id}`, body),
  deleteItem: (id: string) => del<void>(`/inventory/items/${id}`),
  adjustStock: (id: string, body: InventoryItemAdjust) =>
    post<InventoryTransactionOut>(`/inventory/items/${id}/adjust`, body),
  listItemTransactions: (id: string, limit?: number) =>
    get<InventoryTransactionOut[]>(`/inventory/items/${id}/transactions${limit ? `?limit=${limit}` : ""}`),

  // 異動日誌
  listTransactions: (params?: {
    item_id?: string;
    txn_type?: InventoryTxnType;
    limit?: number;
  }) => get<InventoryTransactionOut[]>(`/inventory/transactions${buildQs({
    item_id: params?.item_id,
    txn_type: params?.txn_type,
    limit: params?.limit === undefined ? undefined : String(params.limit),
  })}`),

  // 採購申請
  listProcurements: (params?: {
    status?: InventoryProcurementStatus;
    own_only?: boolean;
  }) => get<InventoryProcurementOut[]>(`/inventory/procurements${buildQs(params ?? {})}`),
  createProcurement: (body: InventoryProcurementCreate) =>
    post<InventoryProcurementOut>("/inventory/procurements", body),
  getProcurement: (id: string) =>
    get<InventoryProcurementOut>(`/inventory/procurements/${id}`),
  updateProcurement: (id: string, body: InventoryProcurementUpdate) =>
    patch<InventoryProcurementOut>(`/inventory/procurements/${id}`, body),
  submitProcurement: (id: string) =>
    post<InventoryProcurementOut>(`/inventory/procurements/${id}/submit`, {}),
  approveProcurement: (id: string) =>
    post<InventoryProcurementOut>(`/inventory/procurements/${id}/approve`, {}),
  rejectProcurement: (id: string, reviewer_notes?: string) =>
    post<InventoryProcurementOut>(
      `/inventory/procurements/${id}/reject${reviewer_notes ? `?reviewer_notes=${encodeURIComponent(reviewer_notes)}` : ""}`,
      {},
    ),
  receiveProcurement: (
    id: string,
    received_quantities: Record<string, number>,
    notes?: string,
  ) =>
    post<InventoryProcurementOut>(`/inventory/procurements/${id}/receive`, {
      received_quantities,
      notes,
    }),

  // 儀表板
  dashboard: () => get<InventoryDashboard>("/inventory/dashboard"),
};
