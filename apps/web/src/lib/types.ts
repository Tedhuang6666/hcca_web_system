/**
 * types.ts — 型別薄層（部分自動生成）
 *
 * 本檔案的主要型別從 api-bridge.ts 再匯出（api-bridge.ts 由 openapi-typescript 自動生成）。
 * 只有無法對應到 OpenAPI schema 的前端特有型別才在此手寫。
 *
 * 更新型別：
 *   ./scripts/update-openapi.sh              # 從 FastAPI 匯出最新 openapi.json
 *   cd apps/web && npm run generate:types     # 重建 api-types.ts
 *   node ../../scripts/generate-bridge.mjs > /tmp/bridge_coverage.json
 *   python3 ../../scripts/rewrite-types-ts.py # 重建本檔
 */

// ── 自動生成型別（從 OpenAPI schema 衍生，do not edit）─────────────────────────
export type {
  Activity,
  ActivityClosingReportOut,
  ActivityConvener,
  ActivityCreate,
  ActivityLinkCreate,
  ActivityLinkKind,
  ActivityLinkOut,
  ActivityLinkSuggestion,
  ActivityMember,
  ActivityRole,
  ActivitySpawnCreate,
  ActivitySpawnOut,
  ActivityStatus,
  ActivityWorkspaceOut,
  AgendaItemType,
  AmendmentComparisonRow,
  AnalyticsInsightsOut,
  AnnouncementAudience,
  AnnouncementAudienceRef,
  AnnouncementCreate,
  AnnouncementListItem,
  AnnouncementMediaOut,
  AnnouncementOut,
  AnnouncementParticipationItem,
  AnnouncementStatsOut,
  AnnouncementUpdate,
  ApprovalStepOut,
  ApprovalStepStatus,
  ApproverOut,
  ArticleType,
  AttachmentOut,
  AttendanceRole,
  AttendanceSourceType,
  AttendanceStatus,
  AuditLogOut,
  AutomationRuleCreate,
  AutomationRuleOut,
  AutomationRuleStatus,
  AutomationRuleUpdate,
  BallotBoxStatus,
  BallotBoxTally,
  BallotChoice,
  BatchDocumentOperationOut,
  BatchDocumentResult,
  CalendarChecklistCreate,
  CalendarChecklistOut,
  CalendarEventCreate,
  CalendarEventListItem,
  CalendarEventOut,
  CalendarEventStatus,
  CalendarEventType,
  CalendarLinkCreate,
  CalendarLinkOut,
  CalendarLinkType,
  CalendarParticipantCreate,
  CalendarParticipantOut,
  CalendarParticipantResponse,
  CalendarParticipantRole,
  CalendarUserBrief,
  CalendarVisibility,
  CandidateTally,
  CartItemOut,
  CartOut,
  CatalogCategoryOut,
  CatalogProductOut,
  CatalogSeriesOut,
  ChannelPref,
  ClassCadreOut,
  ClassManualMemberOut,
  ClassMemberOut,
  ClassMembershipOut,
  ClassRoleBindingOut,
  ClassRoleHolderOut,
  ClassRoleOut,
  ClassStudentRangeOut,
  ClassStudentRangeOverride,
  ClassStudentRangeTemplate,
  ClassUserBrief,
  CloseStatusItem,
  CloseStatusOut,
  ConditionRule,
  ContextLink,
  CouncilProposalCaseType,
  CouncilProposalCreate,
  CouncilProposalKind,
  CouncilProposalListItem,
  CouncilProposalOut,
  CouncilProposalStatus,
  DecisionCreate,
  DecisionOut,
  DecisionStatus,
  DecisionUpdate,
  DeclassificationCondition,
  DefenseRule,
  DefenseSummary,
  DelegateSource,
  DeliveryMethod,
  DeptRankingItem,
  DiscordActivitySyncStatus,
  DiscordActivityWorkspace,
  DiscordBindingOut,
  DiscordBotHealthOut,
  DiscordChannelOptionOut,
  DiscordGuildConfigIn,
  DiscordGuildConfigOut,
  DiscordGuildOptionOut,
  DiscordMemberSyncStateOut,
  DiscordNicknamePrefixRuleIn,
  DiscordNicknamePrefixRuleOut,
  DiscordOrgChannelMappingIn,
  DiscordOrgChannelMappingOut,
  DiscordRoleMappingIn,
  DiscordRoleMappingKind,
  DiscordRoleMappingOut,
  DiscordRoleOptionOut,
  DiscordRolePolicyIn,
  DiscordRolePolicyOut,
  DiscordSyncAllOut,
  DocumentApprovalContextOut,
  DocumentApprovalDelegationOut,
  DocumentCategory,
  DocumentClassification,
  DocumentCreate,
  DocumentEfficiencyOut,
  DocumentListItem,
  DocumentOut,
  DocumentStatus,
  DocumentTemplateCreate,
  DocumentTemplateOut,
  DocumentTemplateUpdate,
  DocumentUrgency,
  DocumentVisibility,
  ElectionListItem,
  ElectionLiveSummary,
  ElectionOut,
  ElectionStatus,
  EmailAnalyticsOut,
  EmailAttachmentOut,
  EmailBlock,
  EmailButton,
  EmailCampaignRecipientOut,
  EmailComposePayload,
  EmailMessageCreate,
  EmailMessageDetailOut,
  EmailMessageOut,
  EmailPreflightOut,
  EmailRecipientListMemberOut,
  EmailRecipientListOut,
  EmailRecipientVariableInput,
  EmailTemplateOut,
  EmailVariableDefinition,
  EntityRelationCreate,
  EntityRelationGraphOut,
  EntityRelationOut,
  ExamGradeTrack,
  ExamPaperDownloadOut,
  ExamPaperListItem,
  ExamPaperOut,
  ExamPaperUpdate,
  ExamTraceInspectMatch,
  ExamTraceInspectOut,
  GoogleCalendarItem,
  GoogleCalendarStatusOut,
  GovernanceCaseCreate,
  GovernanceCaseOut,
  GovernanceCaseUpdate,
  GovernanceDashboardOut,
  GovernanceDiscordEventRouteIn,
  GovernanceDiscordEventRouteOut,
  GovernanceDiscordWorkspaceIn,
  GovernanceDiscordWorkspaceOut,
  GovernanceModuleCapabilityOut,
  GovernanceResourceSearchOut,
  GovernanceStatsOut,
  GovernanceWorkflowTemplateCreate,
  GovernanceWorkflowTemplateOut,
  HoldOut,
  InventoryDashboard,
  InventoryItemType,
  InventoryProcurementStatus,
  InventoryTxnType,
  ItemStatOut,
  JudicialPetitionCreate,
  JudicialPetitionListItem,
  JudicialPetitionOut,
  JudicialPetitionStatus,
  JudicialPetitionType,
  LineBindingOut,
  LineLinkCodeOut,
  LoanAvailableItem,
  LoanCheckoutCreate,
  LoanDashboard,
  LoanItemCreate,
  LoanItemOut,
  LoanItemUpdate,
  LoanRecordOut,
  LoanRecordStatus,
  LoanRecordUpdate,
  LoanUnitOut,
  LoanUnitStatus,
  LoanUnitUpdate,
  MFASetupOut,
  MFAStatusOut,
  MatterCreate,
  MatterLinkRef,
  MatterListItem,
  MatterOut,
  MatterPriority,
  MatterResourceCreate,
  MatterResourceOut,
  MatterResourceType,
  MatterResourceUpdate,
  MatterRoleAssignmentCreate,
  MatterRoleAssignmentOut,
  MatterRoleAssignmentUpdate,
  MatterSpawnResult,
  MatterStatus,
  MatterType,
  MatterUpdate,
  MatterVisibility,
  MealAvailabilityOut,
  MealClassPickupCodeOut,
  MealOrderItemOut,
  MealOrderListItem,
  MealOrderOut,
  MealOrderStatus,
  MealPickupLookupOut,
  MealPickupSlotOut,
  MealProductOut,
  MealVendorApplicationOut,
  MealVendorOut,
  MeetingAgendaAttachmentOut,
  MeetingAgendaItemOut,
  MeetingArtifactLinkOut,
  MeetingArtifactType,
  MeetingAttendanceOut,
  MeetingAttendanceSourceOut,
  MeetingAttendanceSourcePreviewOut,
  MeetingBallotOut,
  MeetingBillStage,
  MeetingBriefingCardOut,
  MeetingClassBrief,
  MeetingDecisionOut,
  MeetingDecisionStatus,
  MeetingEventOut,
  MeetingJoinOut,
  MeetingListItem,
  MeetingMinutesOut,
  MeetingMode,
  MeetingMotionOut,
  MeetingMotionStatus,
  MeetingMotionType,
  MeetingOut,
  MeetingRecusalOut,
  MeetingRegulationBrief,
  MeetingRequestOut,
  MeetingRequestStatus,
  MeetingRequestType,
  MeetingScreenOut,
  MeetingScreenReadingMode,
  MeetingScreenStateOut,
  MeetingSpeechQueueItemOut,
  MeetingSpeechQueueStatus,
  MeetingStatus,
  MeetingTimerStateOut,
  MeetingTimerStatus,
  MeetingUserBrief,
  MeetingVoteOption,
  MeetingVoteOut,
  MeetingVoteRecordMethod,
  MeetingVoteRosterClassOut,
  MeetingVoteRosterOut,
  MeetingVoteTallyOut,
  MeetingWorkspaceOut,
  MenuItemOut,
  MenuItemSummary,
  MenuScheduleListItem,
  MenuScheduleOut,
  NavigationProfileCreate,
  NavigationProfileOut,
  NavigationProfileResolveOut,
  NavigationProfileSection,
  NavigationProfileUpdate,
  NotificationPreferences,
  OptionConfig,
  OrderItemOut,
  OrderListItem,
  OrderOut,
  OrderQuantityRow,
  OrderStatus,
  OrderSummaryOut,
  OrderSummaryRow,
  OrgRead,
  PartnerBusinessCreate,
  PartnerBusinessListItem,
  PartnerBusinessOut,
  PartnerBusinessStatus,
  PartnerBusinessUpdate,
  PartnerLocationCreate,
  PartnerLocationOut,
  PartnerLocationUpdate,
  PartnerMapItem,
  PartnerOfferCreate,
  PartnerOfferOut,
  PartnerOfferUpdate,
  PartnerRankingItem,
  PartnerRatingCreate,
  PartnerRatingOut,
  PartnerSubmissionCreate,
  PartnerSubmissionOut,
  PartnerSubmissionStatus,
  PartnerTagCreate,
  PartnerTagOut,
  PartnerTagUpdate,
  PendingAlertItem,
  PendingConsentItem,
  PersonAffiliationCreate,
  PersonAffiliationKind,
  PersonAffiliationOut,
  PersonAffiliationSource,
  PersonAffiliationStatus,
  PersonAffiliationUpdate,
  PersonCreate,
  PersonDetailOut,
  PersonListItem,
  PersonOut,
  PersonRosterImportResult,
  PersonRosterImportRow,
  PersonStatus,
  PersonUpdate,
  PetitionAttachmentOut,
  PetitionCaseListItem,
  PetitionCaseOut,
  PetitionCreate,
  PetitionCreatedOut,
  PetitionEventOut,
  PetitionEventType,
  PetitionOrgStatsItem,
  PetitionResolutionContextOut,
  PetitionStatsOut,
  PetitionStatus,
  PetitionSubmitterOut,
  PetitionTypeOut,
  PickupListItemOut,
  PlanningDocumentAttachmentOut,
  PlanningDocumentCreate,
  PlanningDocumentOut,
  PlanningDocumentRevisionAttachmentOut,
  PlanningDocumentRevisionCreate,
  PlanningDocumentRevisionOut,
  PlanningDocumentStatus,
  PlanningDocumentUpdate,
  PolicyConsentOut,
  PolicyDocumentListItem,
  PolicyDocumentOut,
  PolicyKind,
  PositionCategory,
  PositionSummary,
  PrivacyRequestOut,
  PrivacyRequestStatus,
  PrivacyRequestType,
  ProductCategoryOut,
  ProductOut,
  ProductSeriesOut,
  ProductStatus,
  ProductVariantGroupOut,
  ProductVariantOptionOut,
  ProgramCreate,
  ProgramOut,
  ProgramUpdate,
  PublicLinkCategoryCreate,
  PublicLinkCategoryOut,
  PublicLinkCategoryUpdate,
  PublicLinkCreate,
  PublicLinkOut,
  PublicLinkUpdate,
  PublicOfficerCandidateOut,
  PublicOfficerOut,
  PublicOfficerProfileCreate,
  PublicOfficerProfileOut,
  PublicOfficerProfileUpdate,
  PublicSiteBundleOut,
  PublicSitePageCreate,
  PublicSitePageOut,
  PublicSitePageUpdate,
  PublicSiteSettingsOut,
  PublicSiteSettingsUpdate,
  PublicationCampaignOut,
  PublicationPreviewOut,
  PublicationStatsOut,
  PublicationStatus,
  QuestionCondition,
  QuestionStats,
  QuestionType,
  RateLimitOverride,
  ReceivableOut,
  ReceivableSource,
  ReceivableStatus,
  ReceivableSummaryOut,
  RecipientOut,
  RecipientPreviewOut,
  RecipientSelector,
  RecipientType,
  RegulationAmendmentType,
  RegulationArticleOut,
  RegulationCategory,
  RegulationListItem,
  RegulationOut,
  RegulationRevisionOut,
  RegulationSearchResult,
  RegulationTreeNodeOut,
  RegulationUsageContextOut,
  RegulationWorkflowLogOut,
  RegulationWorkflowStatus,
  RejectMode,
  RevisionOut,
  SavedFilterOut,
  SchoolClassBulkActionOut,
  SchoolClassBulkActionResult,
  SchoolClassBulkCreate,
  SchoolClassBulkCreateOut,
  SchoolClassBulkCreateResult,
  SchoolClassBulkGradeCreate,
  SchoolClassListItem,
  SchoolClassOut,
  SearchResultOut,
  SeatAssignmentStatus,
  SeatBookingOut,
  SeatInput,
  SeatMapOut,
  SeatOut,
  SeatState,
  SeatStatus,
  SelectedOption,
  SerialTemplateOut,
  ShopClassProductSummaryRow,
  ShopClassSummaryOut,
  ShopOrderCloseOut,
  SurveyAnswerOut,
  SurveyListItem,
  SurveyOut,
  SurveyParticipationItem,
  SurveyQuestionOut,
  SurveyResponseAdminItem,
  SurveyResponseOut,
  SurveyStats,
  SurveyStatus,
  TimelineEventCreate,
  TimelineEventOut,
  UploadedImageOut,
  UserBatchPreRegisterResult,
  UserPositionRead,
  UserRead,
  UserSummary,
  ValidationRule,
  VendorManagerOut,
  VoteEventKind,
  VoteEventOut,
  VoteStatus,
  VoteThresholdType,
  VoteVisibility,
  WaveInput,
  WaveOut,
  WebPushConfigOut,
  WebPushSubscriptionOut,
  WorkItemCreate,
  WorkItemOut,
  WorkItemStatus,
  WorkItemUpdate,
  WorkflowEventOut,
  WorkflowInstanceOut,
  WorkflowLinkCreate,
  WorkflowLinkOut,
  WorkflowTimelineOut,
  WorkflowTransitionCreate,
  YearMode,
  ZoneListItem,
  ZoneOut
} from './api-bridge'

// 手寫型別引用的 api-bridge 型別（內部使用，不重複 export）
import type {
  BallotBoxStatus,
  DeliveryMethod,
  InventoryItemType,
  InventoryProcurementStatus,
  InventoryTxnType,
  PositionCategory,
  PositionSummary,
  RateLimitOverride,
  RecipientType,
} from './api-bridge'

// ── 公文系統型別 ──────────────────────────────────────────────────────────────


export interface ElectionCandidateMember {
  id: string;
  candidate_id: string;
  position: string;
  name: string;
  photo_url: string | null;
  sort_order: number;
}

export interface ElectionCandidate {
  id: string;
  election_id: string;
  name: string;
  number: number;
  color: string;
  sort_order: number;
  is_active: boolean;
  members: ElectionCandidateMember[];
}

export interface ElectionBallotBox {
  id: string;
  election_id: string;
  name: string;
  status: BallotBoxStatus;
  expected_total_votes: number | null;
  sort_order: number;
}


/** 速別：普通件 / 速件 / 最速件 */
/** 公文類別：函 / 令 / 公告 / 報告 / 紀錄 / 咨 / 開會通知單 / 其他 */
/** 可見度：僅當事人 / 機關成員 / 全體登入 / 公開（含未登入） */
/** 遞送方式（後端僅儲存與顯示） */


export interface RecipientCreatePayload {
  recipient_type: RecipientType;
  name: string;
  email?: string | null;
  target_user_id?: string | null;
  target_org_id?: string | null;
  delivery_method?: DeliveryMethod;
}


/** 年份制度 */

/** 字號模板（由擁有 doc.issue 權限的長官建立） */


// ── 商店系統型別 ──────────────────────────────────────────────────────────────


// ── 劃位 / 票券型別 ──────────────────────────────────────────────────────────
export type SeatingMode = "at_purchase" | "scheduled" | "admin_assign";
/** 使用者選位畫面每個座位的即時狀態 */
export type SeatStateKind = "available" | "disabled" | "blocked" | "held" | "mine" | "taken";

export type DecorationKind = "screen" | "door" | "aisle_h" | "aisle_v" | "label" | "box";
export interface LayoutDecoration {
  id: string;
  type: DecorationKind;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color?: string;  // 自訂 CSS 顏色（hex / rgba）
}


// ── 特約地圖型別 ──────────────────────────────────────────────────────────────


// ── 班級系統型別 ──────────────────────────────────────────────────────────────

export type SchoolClassBulkActionKind = "activate" | "deactivate" | "delete";

// ── 人員與身分總表 ────────────────────────────────────────────────────────────


// ── 法規系統型別 ──────────────────────────────────────────────────────────────

/** 法規分類（對應後端 RegulationCategory enum） */


/** 審議流程狀態 */

/** 審議流程日誌 */

/** 修訂歷程 */


/** 全文搜尋結果：RegulationListItem 加上命中的條文 */


// ── 議事系統型別 ──────────────────────────────────────────────────────────────

/** 會議的法案審議階段（決定議程自動帶入哪一階段的法案） */


/** 議程項目關聯法規（修正案）的精簡資訊 */


export type MeetingVoteRosterStatus =
  | "approve"
  | "reject"
  | "abstain"
  | "not_voted"
  | "mixed";


// ── 行事曆型別 ────────────────────────────────────────────────────────────────


// ── 活動系統 ──────────────────────────────────────────────────────────────────


// ── 跨模組工作流 ──────────────────────────────────────────────────────────────


export interface ActivityWorkspaceItem {
  id: string;
  title: string;
  href: string;
  status?: string | null;
  timestamp?: string | null;
  due_at?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  location?: string | null;
  note?: string | null;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}


// ── 使用者 ────────────────────────────────────────────────────────────────────


// ── 稽核日誌 ──────────────────────────────────────────────────────────────────


// ── 管理員 ────────────────────────────────────────────────────────────────────

export interface PermissionCodeInfo {
  group: string;
  code: string;
  label: string;
  desc: string;
}


export interface AdminUserDetail {
  id: string;
  email: string;
  linked_emails: string[];
  display_name: string;
  student_id: string | null;
  avatar_url: string | null;
  is_active: boolean;
  is_superuser: boolean;
  /** Owner 為 OWNER_EMAILS 環境變數驅動的最高權限角色 */
  is_owner: boolean;
  created_at: string;
  positions: PositionSummary[];
  effective_permissions: string[];
}


export interface OrgWithPositions {
  id: string;
  name: string;
  positions: {
    id: string;
    name: string;
    description?: string | null;
    category: PositionCategory;
    weight: number;
    parent_id?: string | null;
    permission_codes: string[];
  }[];
}

// ── 學餐系統型別 ──────────────────────────────────────────────────────────────


/** 排程品項訂購統計（熱門排序用） */

/** 排程領餐名單項 */


// ── 問卷系統型別 ──────────────────────────────────────────────────────────────


/** 選項額外設定：多選互斥／自由輸入 */

/** 文字題型的格式驗證規則 */

/** 單一條件判斷規則 */

/** 題目顯示條件：多條規則由上到下依序左結合評估 */


/** 後台檢視用的單筆填答記錄（含填答者 email） */


// ── 公告系統型別 ──────────────────────────────────────────────────────────────

/** 公告對象：all=全體 / school=全體竹中生 / orgs=特定組織 / members=特定成員 */

/** 公告對象（組織或成員）的精簡顯示用結構 */


// ── 通用型別 ──────────────────────────────────────────────────────────────────

export interface ApiError { detail: string; status: number }
export interface PaginatedResponse<T> { items: T[]; total: number; page: number; size: number }

// ── 財務總帳 ─────────────────────────────────────────────────────────────────
export type FinanceAccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type FundStorageType = "petty_cash" | "safe" | "bank";
export type JournalStatus = "draft" | "pending_review" | "posted" | "returned" | "reversed";
export interface LedgerOut { id: string; org_id: string; name: string; currency: string }
export interface PeriodCreate { name: string; starts_on: string; ends_on: string }
export interface PeriodOut extends PeriodCreate { id: string; ledger_id: string; is_closed: boolean }
export interface ChartAccountCreate { code: string; name: string; account_type: FinanceAccountType }
export interface ChartAccountOut extends ChartAccountCreate { id: string; ledger_id: string; is_active: boolean; is_system: boolean; balance: number }
export interface FundAccountOut { id: string; ledger_id: string; name: string; storage_type: FundStorageType; chart_account_id: string; bank_name: string | null; account_last_four: string | null; is_active: boolean; balance: number }
export interface JournalLineIn { account_id: string; debit?: number; credit?: number; memo?: string }
export interface JournalCreate { period_id: string; entry_date: string; description: string; lines: JournalLineIn[]; source_type?: string; source_id?: string; source_event?: string; source_url?: string; evidence_url?: string; note?: string }
export interface TransferCreate { period_id: string; entry_date: string; from_fund_account_id: string; to_fund_account_id: string; amount: number; description: string; note?: string }
export interface JournalOut { id: string; ledger_id: string; period_id: string; entry_date: string; description: string; status: JournalStatus; created_by_id: string; reviewed_by_id: string | null; posted_at: string | null; source_type: string | null; source_id: string | null; source_event: string | null; source_url: string | null; evidence_url: string | null; note: string | null; lines: (JournalLineIn & { id: string; account_name: string })[] }

// ── 常用篩選（Saved Filters）──────────────────────────────────────────────────


// ── 陳情系統型別 ──────────────────────────────────────────────────────────────


export type PetitionVisibility = "public" | "internal";


// ── 議會提案 ───────────────────────────────────────────────────────────────


export interface CouncilProposalEligibleMeeting {
  id: string;
  title: string;
  status: string;
  bill_stage: string | null;
  starts_at: string | null;
  already_scheduled: boolean;
}

// ── 評議委員會訴訟 ───────────────────────────────────────────────────────


// ── 通知偏好（站內 / Email 多管道）──────────────────────────────────────────


// ── 系統防護 ───────────────────────────────────────────────────────────────

export type DefenseRuleType =
  | "ip_block"
  | "cidr_block"
  | "ip_allow"
  | "rate_limit_override"
  | "endpoint_lockdown"
  | "bot_challenge_placeholder";


export interface RateLimitConfig {
  enabled: boolean;
  global_requests: number;
  global_window_seconds: number;
  overrides: RateLimitOverride[];
}


// ── 事情治理中樞 ─────────────────────────────────────────────────────────────

export type GovernanceCaseStatus =
  | "draft"
  | "todo"
  | "in_progress"
  | "review"
  | "approved"
  | "done"
  | "archived"
  | "canceled";


export type MatterSpawnKind =
  | "task"
  | "announcement"
  | "survey"
  | "meeting"
  | "document"
  | "regulation";

/** 從事情主動建立並連動的artifact回傳。 */

/** 反向查詢：某模組資源被哪些事情納入。 */

/** 自動化規則編輯器選項（後端 /governance/automation-meta）。 */
export interface AutomationMeta {
  trigger_types: Record<string, string>;
  action_types: Record<string, string>;
  entity_types: Record<string, string>;
}


// ── 公告統計 ─────────────────────────────────────────────────────────────────


// ── 公文效率統計 ──────────────────────────────────────────────────────────────


export interface AnalyticsInsightItem {
  id: string;
  module: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  score: number;
  href: string;
  reason: string;
  recommended_action: string;
  created_at: string;
}


// ── 電子郵件 ─────────────────────────────────────────────────────────────────

export type EmailStatus =
  | "draft"
  | "scheduled"
  | "queued"
  | "sent"
  | "failed"
  | "retrying"
  | "dead"
  | "partial"
  | "cancelled";


export interface EmailCardRow {
  label: string;
  value: string;
}


export type EmailButtonStyle = "primary" | "secondary" | "outline";


export type EmailBlockType = "text" | "image" | "divider";


export type EmailResourceVisibility = "private" | "org";


/** 職位精簡資訊（收件人選擇器用） */
export interface EmailPosition {
  id: string;
  name: string;
}

// ── 段考題庫 ────────────────────────────────────────────────────────────────


// ── 政策、同意與個資請求 ────────────────────────────────────────────────


// ── 公開官網 / Linktree ──────────────────────────────────────────────────────


// ── 物品借用系統 ───────────────────────────────────────────────────────────────


// ── 物資管理系統 ──────────────────────────────────────────────────────────────


export interface InventoryCategoryOut {
  id: string;
  org_id: string;
  name: string;
  color: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface InventoryCategoryCreate {
  name: string;
  color?: string;
  sort_order?: number;
  org_id?: string;
}

export interface InventoryCategoryUpdate {
  name?: string;
  color?: string;
  sort_order?: number;
  is_active?: boolean;
}

export interface InventoryItemOut {
  id: string;
  org_id: string;
  category_id: string | null;
  category_name: string | null;
  name: string;
  description: string | null;
  unit: string;
  item_type: InventoryItemType;
  quantity: number;
  low_stock_threshold: number;
  is_low_stock: boolean;
  location: string | null;
  image_url: string | null;
  is_active: boolean;
  loan_item_id: string | null;
  created_at: string;
}

export interface InventoryItemCreate {
  name: string;
  description?: string;
  unit?: string;
  item_type?: InventoryItemType;
  quantity?: number;
  low_stock_threshold?: number;
  location?: string;
  image_url?: string;
  category_id?: string;
  loan_item_id?: string;
  org_id?: string;
}

export interface InventoryItemUpdate {
  name?: string;
  description?: string;
  unit?: string;
  item_type?: InventoryItemType;
  low_stock_threshold?: number;
  location?: string;
  image_url?: string;
  category_id?: string;
  loan_item_id?: string;
  is_active?: boolean;
}

export interface InventoryItemAdjust {
  txn_type: InventoryTxnType;
  quantity: number;
  notes?: string;
}

export interface InventoryTransactionOut {
  id: string;
  item_id: string;
  item_name: string;
  txn_type: InventoryTxnType;
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface InventoryProcurementItemOut {
  id: string;
  item_id: string | null;
  item_name: string;
  item_unit: string;
  quantity_requested: number;
  quantity_received: number;
  estimated_unit_price: number | null;
  notes: string | null;
}

export interface InventoryProcurementOut {
  id: string;
  org_id: string;
  title: string;
  status: InventoryProcurementStatus;
  estimated_amount: number | null;
  requester_id: string;
  requester_name: string;
  reviewer_id: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  requester_notes: string | null;
  reviewer_notes: string | null;
  created_at: string;
  line_items: InventoryProcurementItemOut[];
}

export interface InventoryProcurementItemIn {
  item_id?: string;
  item_name: string;
  item_unit?: string;
  quantity_requested: number;
  estimated_unit_price?: number;
  notes?: string;
}

export interface InventoryProcurementCreate {
  title: string;
  requester_notes?: string;
  estimated_amount?: number;
  line_items?: InventoryProcurementItemIn[];
  org_id?: string;
}

export interface InventoryProcurementUpdate {
  title?: string;
  requester_notes?: string;
  estimated_amount?: number;
  line_items?: InventoryProcurementItemIn[];
}


// ── Google Calendar 同步 ──────────────────────────────────────────────────────
