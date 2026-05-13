// ── 公文系統型別 ──────────────────────────────────────────────────────────────

export type DocumentStatus = "draft" | "pending" | "approved" | "rejected" | "archived";
/** 速別：普通件 / 速件 / 最速件 */
export type DocumentUrgency = "normal" | "priority" | "express";
export type DocumentClassification = "normal" | "confidential" | "secret";
export type DeclassificationCondition = "none" | "auto_at_date" | "manual_approval";
/** 公文類別：函 / 令 / 公告 / 報告 / 開會通知單 / 其他 */
export type DocumentCategory = "letter" | "decree" | "announcement" | "report" | "meeting_notice" | "other";
/** 可見度：僅當事人 / 機關成員 / 全體登入 / 公開（含未登入） */
export type DocumentVisibility = "subject_only" | "org_only" | "public" | "publicly_open";
export type RecipientType = "main" | "primary" | "copy";
export type ApprovalStepStatus = "pending" | "approved" | "rejected" | "waiting" | "skipped";
export type DelegateSource = "manual" | "assignment";
export type RejectMode = "to_creator" | "to_previous";

export interface RecipientOut {
  id: string;
  recipient_type: RecipientType;
  name: string;
  email: string | null;
}

export interface AttachmentOut {
  id: string;
  filename: string;
  display_name: string | null;
  content_type: string | null;
  file_size: number | null;
  url: string;
  link_url: string | null;
  uploaded_by: string;
  created_at: string;
}

export interface RevisionOut {
  id: string;
  revision_number: number;
  title: string;
  content: string;
  change_note: string | null;
  changed_by: string;
  created_at: string;
}

export interface ApproverOut { id: string; name: string; email: string }

export interface ApprovalStepOut {
  id: string;
  step_order: number;
  status: ApprovalStepStatus;
  comment: string | null;
  decided_at: string | null;
  is_acting: boolean;
  delegate_source: DelegateSource | null;
  approver: ApproverOut;
  delegate: ApproverOut | null;
  approver_title: string | null;
  delegate_title: string | null;
}

export interface DocumentApprovalDelegationOut {
  id: string;
  org_id: string;
  principal_user_id: string;
  delegate_user_id: string;
  start_at: string;
  end_at: string | null;
  reason: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  principal_user: ApproverOut;
  delegate_user: ApproverOut;
}

export interface DocumentOut {
  id: string;
  serial_number: string;
  title: string;
  issuer_full_name: string | null;
  urgency: DocumentUrgency;
  classification: DocumentClassification;
  declassification_condition: DeclassificationCondition;
  confidentiality_expires_at: string | null;
  category: DocumentCategory;
  subject: string | null;
  doc_description: string | null;
  action_required: string | null;
  content: string;
  meeting_purpose: string | null;
  meeting_time: string | null;
  meeting_location: string | null;
  meeting_chairperson: string | null;
  handler_name: string | null;
  handler_unit: string | null;
  handler_email: string | null;
  file_number: string | null;
  retention_period: string | null;
  status: DocumentStatus;
  current_step: number;
  issued_at: string | null;
  due_date: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  page_info: string | null;
  created_at: string;
  updated_at: string;
  visibility_level: DocumentVisibility;
  is_public: boolean;
  org_id: string;
  created_by: string;
  serial_template_id: string | null;
  revisions: RevisionOut[];
  approvals: ApprovalStepOut[];
  attachments: AttachmentOut[];
  recipients: RecipientOut[];
}

/** 年份制度 */
export type YearMode = "roc" | "ce";

/** 字號模板（由擁有 doc.issue 權限的長官建立） */
export interface SerialTemplateOut {
  id: string;
  org_id: string;
  org_prefix: string;
  category_char: string;
  year_mode: YearMode;
  reset_on_new_year: boolean;
  current_year: number;
  counter: number;
  is_active: boolean;
  is_default: boolean;
  is_default_president_publish: boolean;
  description: string | null;
  created_by: string;
  created_at: string;
  /** 下一個字號預覽，由後端計算（e.g. 嶺代生字第 1150000001 號（預覽）） */
  preview: string;
}

export interface DocumentListItem {
  id: string; serial_number: string; title: string;
  urgency: DocumentUrgency; classification: DocumentClassification; category: DocumentCategory;
  subject: string | null; status: DocumentStatus;
  org_id: string; created_by: string;
  due_date: string | null; submitted_at: string | null; completed_at: string | null; created_at: string;
}

export interface DocumentCreate {
  title: string; org_id: string;
  issuer_full_name?: string | null;
  serial_template_id?: string | null;
  urgency?: DocumentUrgency; classification?: DocumentClassification; category?: DocumentCategory;
  declassification_condition?: DeclassificationCondition;
  confidentiality_expires_at?: string | null;
  subject?: string; doc_description?: string; action_required?: string;
  content?: string;
  meeting_purpose?: string; meeting_time?: string;
  meeting_location?: string; meeting_chairperson?: string;
  handler_name?: string; handler_unit?: string; handler_email?: string;
  file_number?: string; retention_period?: string;
  due_date?: string;
  page_info?: string;
  visibility_level?: DocumentVisibility;
  recipients?: { recipient_type: RecipientType; name: string; email?: string }[];
}

// ── 商店系統型別 ──────────────────────────────────────────────────────────────

export type ProductStatus = "draft" | "active" | "sold_out" | "archived";
export type OrderStatus = "pending" | "confirmed" | "cancelled" | "refunded";

export interface ProductOut {
  id: string; name: string; description: string | null;
  price: number; stock_quantity: number; is_unlimited: boolean;
  status: ProductStatus; version: number;
  org_id: string; created_by: string;
  sale_start: string | null; sale_end: string | null;
  created_at: string; updated_at: string;
}

export interface OrderItemOut { id: string; product_id: string; quantity: number; unit_price: number; subtotal: number }
export interface OrderOut {
  id: string; serial_number: string; user_id: string; org_id: string;
  status: OrderStatus; total_price: number; notes: string | null;
  created_at: string; updated_at: string; items: OrderItemOut[];
}
export interface OrderListItem {
  id: string; serial_number: string; user_id: string; org_id: string;
  status: OrderStatus; total_price: number; created_at: string;
}
export interface OrderCreate {
  items: { product_id: string; quantity: number }[];
  notes?: string;
}

// ── 法規系統型別 ──────────────────────────────────────────────────────────────

/** 法規分類（對應後端 RegulationCategory enum） */
export type RegulationCategory =
  | "constitution"       // 憲章
  | "chairman"           // 主席相關
  | "executive_dept"     // 行政部門
  | "student_council"    // 學生議會
  | "judicial_committee" // 評議委員會
  | "executive_order"    // 行政命令
  | "council_order"      // 議會命令
  | "judicial_order"     // 評議委員會命令
  | "election_order"     // 選舉委員會命令
  | "other";             // 其他

/** 條文層級（Volume > Chapter > Section > Article > Paragraph > Subparagraph > Item） */
export type ArticleType =
  | "volume"         // 編
  | "chapter"        // 章
  | "section"        // 節
  | "article"        // 條（新）
  | "paragraph"      // 項（新）
  | "subparagraph"   // 款（新）
  | "item"           // 目（新）
  | "special_clause" // 特殊條文（如附則）
  // 舊值保留向下相容（已廢棄）
  | "clause"         // 舊：條（請改用 article）
  | "subsection";    // 舊：款（請改用 subparagraph）

/** 結構化條文 */
export interface RegulationArticleOut {
  id: string;
  regulation_id: string;
  sort_index: number;
  order_index: number;
  parent_id?: string | null;
  article_type: ArticleType;
  title: string;
  subtitle: string;
  legal_number?: string | null;
  content: string | null;
  is_deleted: boolean;
  frozen_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegulationTreeNodeOut {
  id: string;
  type: ArticleType;
  title: string;
  content: string | null;
  order_index: number;
  parent_id: string | null;
  legal_number: string | null;
  children: RegulationTreeNodeOut[];
}

/** 審議流程狀態 */
export type RegulationWorkflowStatus =
  | "draft"
  | "under_review"
  | "scheduled"
  | "council_approved"
  | "published"
  | "rejected"
  | "archived";
export type RegulationAmendmentType = "enact" | "amend" | "abolish";

/** 審議流程日誌 */
export interface RegulationWorkflowLogOut {
  id: string;
  from_status: RegulationWorkflowStatus;
  to_status: RegulationWorkflowStatus;
  actor_id: string;
  note: string | null;
  created_at: string;
}

/** 修訂歷程 */
export interface RegulationRevisionOut {
  id: string;
  regulation_id: string;
  version: number;
  change_brief: string;
  is_total_amendment: boolean;
  content_snapshot: string;
  article_snapshot?: string | null;
  proposal_metadata_snapshot?: string | null;
  resolution_link: string | null;
  amended_at: string;
  amended_by: string;
  amended_by_name?: string | null;
  created_at: string;
}

export interface RegulationOut {
  id: string; title: string; category: RegulationCategory;
  content: string; preface: string | null; version: number; is_active: boolean;
  workflow_status: RegulationWorkflowStatus; workflow_note: string | null;
  amendment_type: RegulationAmendmentType;
  amended_articles: string | null;
  effective_date: string | null;
  legislative_history: string | null;
  legal_basis: string | null;
  proposal_metadata: string | null;
  org_id: string; created_by: string; created_by_name?: string | null;
  published_at: string | null; created_at: string; updated_at: string;
  published_document_id: string | null;
  /** 整部法規凍結欄位 */
  freeze_reason: string | null;
  freeze_at: string | null;
  freeze_document_id: string | null;
  /** 廢止欄位 */
  is_repealed: boolean;
  repealed_date: string | null;
  repeal_reason: string | null;
  repeal_replacement_id: string | null;
  articles: RegulationArticleOut[];
  revisions: RegulationRevisionOut[];
  workflow_logs: RegulationWorkflowLogOut[];
}

export interface RegulationListItem {
  id: string; title: string; category: RegulationCategory;
  version: number; is_active: boolean; workflow_status: RegulationWorkflowStatus;
  is_repealed: boolean;
  org_id: string;
  published_at: string | null;
  repealed_date: string | null;
  freeze_reason: string | null;
  freeze_at: string | null;
  created_at: string; updated_at: string;
}

// ── 使用者 ────────────────────────────────────────────────────────────────────

export interface UserRead {
  id: string;
  email: string;
  display_name: string;
  student_id: string | null;
  avatar_url: string | null;
  show_email: boolean;
  is_active: boolean;
  is_verified: boolean;
  is_superuser: boolean;
}

export interface MFAStatusOut {
  mfa_enabled: boolean;
  has_pending_setup: boolean;
  backup_code_count: number;
}

export interface MFASetupOut {
  secret: string;
  qr_uri: string;
  backup_codes: string[];
}

export interface UserSummary {
  id: string;
  display_name: string;
  email: string;
}

export interface OrgRead {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  prefix: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserPositionRead {
  id: string;
  user_id: string;
  position_id: string;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  position_name: string;
  position_org_id: string | null;
  position_org_name: string;
}

// ── 稽核日誌 ──────────────────────────────────────────────────────────────────

export interface AuditLogOut {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  meta: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
  summary: string | null;
}

// ── 管理員 ────────────────────────────────────────────────────────────────────

export interface PermissionCodeInfo {
  group: string;
  code: string;
  label: string;
  desc: string;
}

export interface PositionSummary {
  id: string;
  name: string;
  org_id: string;
  org_name: string;
  description?: string | null;
  weight: number;
  parent_id?: string | null;
  permission_codes: string[];
  user_position_id?: string | null;
}

export interface AdminUserDetail {
  id: string;
  email: string;
  display_name: string;
  student_id: string | null;
  avatar_url: string | null;
  is_active: boolean;
  is_superuser: boolean;
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
    weight: number;
    parent_id?: string | null;
    permission_codes: string[];
  }[];
}

// ── 學餐系統型別 ──────────────────────────────────────────────────────────────

export type MealOrderStatus = "pending" | "confirmed" | "cancelled" | "completed";

export interface MealVendorOut {
  id: string;
  name: string;
  description: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  is_active: boolean;
  org_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MenuItemSummary {
  id: string;
  name: string;
  description: string | null;
  price: number;
  max_quantity: number | null;
  is_available: boolean;
}

export interface MenuItemOut {
  id: string;
  schedule_id: string;
  name: string;
  description: string | null;
  price: number;
  max_quantity: number | null;
  is_available: boolean;
  created_at: string;
  updated_at: string;
}

export interface MenuScheduleOut {
  id: string;
  vendor_id: string;
  date: string;
  order_open_time: string | null;
  order_deadline: string;
  is_closed: boolean;
  note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  items: MenuItemSummary[];
}

export interface MenuScheduleListItem {
  id: string;
  vendor_id: string;
  date: string;
  order_open_time: string | null;
  order_deadline: string;
  is_closed: boolean;
  note: string | null;
  created_at: string;
}

export interface MealOrderItemOut {
  id: string;
  menu_item_id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface MealOrderOut {
  id: string;
  serial_number: string;
  pickup_code: string;
  user_id: string;
  schedule_id: string;
  vendor_id: string;
  status: MealOrderStatus;
  total_price: number;
  notes: string | null;
  reminder_sent_at: string | null;
  is_no_show: boolean;
  created_at: string;
  updated_at: string;
  items: MealOrderItemOut[];
}

export interface MealOrderListItem {
  id: string;
  serial_number: string;
  pickup_code: string;
  user_id: string;
  schedule_id: string;
  vendor_id: string;
  status: MealOrderStatus;
  total_price: number;
  is_no_show: boolean;
  created_at: string;
}

/** 排程品項訂購統計（熱門排序用） */
export interface ItemStatOut {
  item_id: string;
  item_name: string;
  total_ordered: number;
}

/** 排程領餐名單項 */
export interface PickupListItemOut {
  order_id: string;
  serial_number: string;
  pickup_code: string;
  status: MealOrderStatus;
  total_price: number;
  notes: string | null;
  created_at: string;
  display_name: string;
  student_id: string | null;
  is_no_show: boolean;
}

export interface VendorManagerOut {
  user_id: string;
  display_name: string;
  email: string;
  position_id: string;
  user_position_id: string;
}

// ── 問卷系統型別 ──────────────────────────────────────────────────────────────

export type SurveyStatus = "draft" | "open" | "closed" | "archived";
export type QuestionType = "text" | "textarea" | "single" | "multiple" | "rating" | "date";

export interface SurveyQuestionOut {
  id: string;
  survey_id: string;
  order_index: number;
  question_text: string;
  question_type: QuestionType;
  is_required: boolean;
  options: string[];
  min_value: number | null;
  max_value: number | null;
  placeholder: string | null;
}

export interface SurveyOut {
  id: string;
  title: string;
  description: string | null;
  status: SurveyStatus;
  is_anonymous: boolean;
  allow_multiple: boolean;
  opens_at: string | null;
  closes_at: string | null;
  org_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  questions: SurveyQuestionOut[];
  response_count: number;
}

export interface SurveyListItem {
  id: string;
  title: string;
  status: SurveyStatus;
  is_anonymous: boolean;
  opens_at: string | null;
  closes_at: string | null;
  org_id: string;
  created_by: string;
  created_at: string;
  response_count: number;
}

export interface SurveyResponseOut {
  id: string;
  survey_id: string;
  submitted_at: string;
  answers: { id: string; question_id: string; answer_text: string | null; answer_options: string[] }[];
}

export interface QuestionStats {
  question_id: string;
  question_text: string;
  question_type: QuestionType;
  total_responses: number;
  option_counts: Record<string, number>;
  text_answers: string[];
  average_rating: number | null;
}

export interface SurveyStats {
  survey_id: string;
  title: string;
  total_responses: number;
  questions: QuestionStats[];
}

// ── 公告系統型別 ──────────────────────────────────────────────────────────────

export interface AnnouncementMediaOut {
  id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  url: string;
  created_at: string;
}

export interface AnnouncementOut {
  id: string;
  title: string;
  content: Record<string, unknown>;
  is_urgent: boolean;
  urgent_until: string | null;
  is_published: boolean;
  published_at: string | null;
  org_id: string | null;
  author_id: string;
  author_name: string;
  created_at: string;
  updated_at: string;
  media: AnnouncementMediaOut[];
}

export interface AnnouncementListItem {
  id: string;
  title: string;
  is_urgent: boolean;
  is_published: boolean;
  published_at: string | null;
  org_id: string | null;
  author_id: string;
  author_name: string;
  created_at: string;
}

export interface AnnouncementCreate {
  title: string;
  content: Record<string, unknown>;
  is_urgent?: boolean;
  urgent_until?: string | null;
  org_id?: string | null;
}

export interface AnnouncementUpdate {
  title?: string;
  content?: Record<string, unknown>;
  is_urgent?: boolean;
  urgent_until?: string | null;
  is_published?: boolean;
}

// ── 通用型別 ──────────────────────────────────────────────────────────────────

export interface ApiError { detail: string; status: number }
export interface PaginatedResponse<T> { items: T[]; total: number; page: number; size: number }

// ── 常用篩選（Saved Filters）──────────────────────────────────────────────────

export interface SavedFilterOut {
  id: string;
  scope: string;
  name: string;
  description: string | null;
  params: Record<string, unknown>;
  share_path: string | null;
  created_at: string;
  updated_at: string;
}

// ── 陳情系統型別 ──────────────────────────────────────────────────────────────

export type PetitionStatus =
  | "submitted"
  | "assigned"
  | "in_progress"
  | "needs_info"
  | "transferred"
  | "resolved"
  | "closed"
  | "rejected";

export type PetitionEventType =
  | "created"
  | "assigned"
  | "status_changed"
  | "transferred"
  | "needs_info"
  | "supplemented"
  | "replied"
  | "closed"
  | "rejected"
  | "note"
  | "attachment_added";

export type PetitionVisibility = "public" | "internal";

export interface PetitionTypeOut {
  id: string;
  name: string;
  description: string | null;
  responsible_org_id: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PetitionCreate {
  type_id: string;
  is_named: boolean;
  contact_name?: string | null;
  contact_email?: string | null;
  title: string;
  content: string;
}

export interface PetitionCreatedOut {
  id: string;
  case_number: string;
  verification_code: string;
  status: PetitionStatus;
  title: string;
  status_label: string;
  status_public_message: string;
  next_action: string;
  created_at: string;
}

export interface PetitionSubmitterOut {
  id: string | null;
  display_name: string | null;
  email: string | null;
  student_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
}

export interface PetitionAttachmentOut {
  id: string;
  filename: string;
  display_name: string | null;
  content_type: string | null;
  file_size: number | null;
  visibility: PetitionVisibility;
  uploaded_by: string | null;
  created_at: string;
  url: string;
}

export interface PetitionEventOut {
  id: string;
  event_type: PetitionEventType;
  visibility: PetitionVisibility;
  actor_id: string | null;
  from_org_id: string | null;
  to_org_id: string | null;
  from_status: string | null;
  to_status: string | null;
  title: string;
  content: string | null;
  created_at: string;
}

export interface PetitionCaseListItem {
  id: string;
  case_number: string;
  type_id: string;
  status: PetitionStatus;
  is_named: boolean;
  title: string;
  current_org_id: string;
  assigned_to_id: string | null;
  submitted_at: string;
  updated_at: string;
  status_label: string;
  status_public_message: string;
  next_action: string;
  type_name: string;
  current_org_name: string;
  assigned_to_name: string | null;
}

export interface PetitionCaseOut extends PetitionCaseListItem {
  content: string;
  public_reply: string | null;
  latest_internal_note: string | null;
  supplement_request: string | null;
  rejection_reason: string | null;
  submitter_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  assigned_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  can_supplement: boolean;
  can_view_submitter: boolean;
  submitter: PetitionSubmitterOut | null;
  events: PetitionEventOut[];
  attachments: PetitionAttachmentOut[];
}

export interface PetitionOrgStatsItem {
  org_id: string;
  org_name: string;
  total: number;
  submitted: number;
  assigned: number;
  in_progress: number;
  needs_info: number;
  transferred: number;
  resolved: number;
  closed: number;
  rejected: number;
  completed: number;
  average_first_response_hours: number | null;
  average_completion_hours: number | null;
}

export interface PetitionStatsOut {
  total: number;
  pending_assignment: number;
  my_assigned: number;
  needs_info: number;
  in_progress: number;
  resolved: number;
  closed_this_month: number;
  by_org: PetitionOrgStatsItem[];
}

// ── 通知偏好 ─────────────────────────────────────────────────────────────────

export interface NotificationPreferences {
  document_pending: boolean;
  document_approved: boolean;
  document_rejected: boolean;
  document_recalled: boolean;
  announcement: boolean;
  system: boolean;
}

// ── 公告統計 ─────────────────────────────────────────────────────────────────

export interface AnnouncementStatsOut {
  announcement_id: string;
  title: string;
  reader_count: number;
  published_at: string | null;
}

// ── 公文效率統計 ──────────────────────────────────────────────────────────────

export interface DocumentEfficiencyOut {
  avg_processing_hours: number | null;
  total_documents: number;
  completed_documents: number;
  overdue_count: number;
  overdue_rate: number;
}

export interface DeptRankingItem {
  org_id: string;
  org_name: string;
  avg_processing_hours: number | null;
  total_docs: number;
}

export interface PendingAlertItem {
  approval_id: string;
  document_id: string;
  document_title: string;
  step_order: number;
  waiting_hours: number;
}

export interface AnnouncementParticipationItem {
  announcement_id: string;
  title: string;
  reader_count: number;
  published_at: string | null;
}

export interface SurveyParticipationItem {
  survey_id: string;
  title: string;
  response_count: number;
  status: SurveyStatus;
  created_at: string;
}
