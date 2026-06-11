// ── 公文系統型別 ──────────────────────────────────────────────────────────────

export type DocumentStatus = "draft" | "pending" | "approved" | "rejected" | "archived";

export type ElectionStatus = "draft" | "live" | "paused" | "closed";
export type BallotBoxStatus = "pending" | "counting" | "paused" | "locked";
export type VoteEventKind = "candidate" | "invalid";

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

export interface ElectionOut {
  id: string;
  title: string;
  slug: string | null;
  description: string | null;
  status: ElectionStatus;
  is_public: boolean;
  seats: number;
  eligible_voter_count: number | null;
  turnout_threshold_pct: number | null;
  vote_threshold_pct: number | null;
  created_by_id: string;
  candidates: ElectionCandidate[];
  ballot_boxes: ElectionBallotBox[];
  created_at: string;
  updated_at: string;
}

export interface ElectionListItem {
  id: string;
  title: string;
  slug: string | null;
  status: ElectionStatus;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface VoteEventOut {
  id: string;
  election_id: string;
  ballot_box_id: string;
  ballot_box_name: string;
  candidate_id: string | null;
  candidate_name: string | null;
  kind: VoteEventKind;
  delta: number;
  reason: string;
  operator_id: string;
  operator_name: string;
  reverses_event_id: string | null;
  created_at: string;
}

export interface CandidateTally {
  candidate_id: string;
  name: string;
  number: number;
  color: string;
  members: ElectionCandidateMember[];
  votes: number;
  percentage: number;
  rank: number;
  meets_threshold: boolean;
  is_elected: boolean;
}

export interface BallotBoxTally {
  ballot_box_id: string;
  name: string;
  status: BallotBoxStatus;
  counted_votes: number;
  invalid_votes: number;
  expected_total_votes: number | null;
  progress_percentage: number | null;
}

export interface ElectionLiveSummary {
  election_id: string;
  slug: string | null;
  title: string;
  status: ElectionStatus;
  seats: number;
  eligible_voter_count: number | null;
  turnout_threshold_pct: number | null;
  turnout_pct: number | null;
  turnout_met: boolean;
  vote_threshold_pct: number | null;
  threshold_votes: number | null;
  total_votes: number;
  valid_votes: number;
  invalid_votes: number;
  expected_total_votes: number | null;
  progress_percentage: number | null;
  leader_candidate_id: string | null;
  current_ballot_boxes: string[];
  candidates: CandidateTally[];
  ballot_boxes: BallotBoxTally[];
  last_updated_at: string;
}
/** 速別：普通件 / 速件 / 最速件 */
export type DocumentUrgency = "normal" | "priority" | "express";
export type DocumentClassification = "normal" | "confidential" | "secret";
export type DeclassificationCondition = "none" | "auto_at_date" | "manual_approval";
/** 公文類別：函 / 令 / 公告 / 報告 / 紀錄 / 咨 / 開會通知單 / 其他 */
export type DocumentCategory =
  | "letter"
  | "decree"
  | "announcement"
  | "report"
  | "record"
  | "consultation"
  | "meeting_notice"
  | "other";
/** 可見度：僅當事人 / 機關成員 / 全體登入 / 公開（含未登入） */
export type DocumentVisibility = "subject_only" | "org_only" | "public" | "publicly_open";
export type RecipientType = "main" | "primary" | "copy";
export type ApprovalStepStatus = "pending" | "approved" | "rejected" | "waiting" | "skipped";
export type DelegateSource = "manual" | "assignment";
export type RejectMode = "to_creator" | "to_previous";
/** 遞送方式（後端僅儲存與顯示） */
export type DeliveryMethod = "none" | "system" | "email" | "paper" | "postal";

export interface RecipientOut {
  id: string;
  recipient_type: RecipientType;
  name: string;
  email: string | null;
  target_user_id: string | null;
  target_org_id: string | null;
  delivery_method: DeliveryMethod;
}

export interface RecipientCreatePayload {
  recipient_type: RecipientType;
  name: string;
  email?: string | null;
  target_user_id?: string | null;
  target_org_id?: string | null;
  delivery_method?: DeliveryMethod;
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
  org_id: string | null;
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
  activity_id: string | null;
  created_by: string;
  serial_template_id: string | null;
  regulation_id: string | null;
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
  org_id: string; activity_id: string | null; created_by: string;
  due_date: string | null; submitted_at: string | null; completed_at: string | null; created_at: string;
  is_redacted: boolean;
}

export interface DocumentCreate {
  title: string; org_id: string;
  activity_id?: string | null;
  issuer_full_name?: string | null;
  serial_template_id?: string | null;
  manual_serial_number?: string | null;
  urgency?: DocumentUrgency; classification?: DocumentClassification; category?: DocumentCategory;
  declassification_condition?: DeclassificationCondition;
  confidentiality_expires_at?: string | null;
  subject?: string | null; doc_description?: string | null; action_required?: string | null;
  content?: string;
  meeting_purpose?: string; meeting_time?: string;
  meeting_location?: string; meeting_chairperson?: string;
  handler_name?: string; handler_unit?: string; handler_email?: string;
  file_number?: string; retention_period?: string;
  due_date?: string;
  page_info?: string;
  visibility_level?: DocumentVisibility;
  recipients?: RecipientCreatePayload[];
}

export interface BatchDocumentResult {
  document_id: string;
  serial_number: string | null;
  title: string | null;
  ok: boolean;
  status: DocumentStatus | null;
  detail: string | null;
}

export interface BatchDocumentOperationOut {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchDocumentResult[];
}

export interface DocumentTemplateOut {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  version: number;
  is_active: boolean;
  issuer_full_name: string | null;
  urgency: DocumentUrgency;
  classification: DocumentClassification;
  declassification_condition: DeclassificationCondition;
  category: DocumentCategory;
  subject: string | null;
  doc_description: string | null;
  action_required: string | null;
  content: string;
  meeting_purpose: string | null;
  meeting_location: string | null;
  meeting_chairperson: string | null;
  handler_unit: string | null;
  file_number: string | null;
  retention_period: string | null;
  visibility_level: DocumentVisibility;
  recipients: RecipientCreatePayload[];
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type DocumentTemplateCreate = Omit<
  DocumentTemplateOut,
  "id" | "version" | "is_active" | "created_by" | "updated_by" | "created_at" | "updated_at"
>;

export type DocumentTemplateUpdate = Partial<DocumentTemplateCreate> & { is_active?: boolean };

// ── 商店系統型別 ──────────────────────────────────────────────────────────────

export type ProductStatus = "draft" | "active" | "sold_out" | "cancelled";
export type OrderStatus = "pending" | "confirmed" | "cancelled" | "refunded";

export interface ProductVariantOptionOut {
  id: string; group_id: string; value: string;
  image_url: string | null; price_delta: number;
  sort_order: number; is_active: boolean;
}
export interface ProductVariantGroupOut {
  id: string; product_id: string; name: string; sort_order: number;
  options: ProductVariantOptionOut[];
}
export interface ProductOut {
  id: string; name: string; description: string | null;
  image_url: string | null;
  price: number; stock_quantity: number; is_unlimited: boolean;
  status: ProductStatus; version: number;
  series_id: string; org_id: string; created_by: string;
  sale_start: string | null; sale_end: string | null;
  requires_seating: boolean; seating_mode: SeatingMode | null;
  created_at: string; updated_at: string;
  variant_groups: ProductVariantGroupOut[];
}
export interface ProductCategoryOut {
  id: string; org_id: string; activity_id: string | null; name: string;
  description: string | null; image_url: string | null;
  sort_order: number; is_active: boolean;
  created_by: string; created_at: string; updated_at: string;
}
export interface ProductSeriesOut {
  id: string; category_id: string; name: string;
  description: string | null; image_url: string | null;
  sort_order: number; is_active: boolean;
  created_at: string; updated_at: string;
}
export interface CatalogProductOut {
  id: string; name: string; image_url: string | null;
  price: number; status: ProductStatus;
  stock_quantity: number; is_unlimited: boolean;
  sale_start: string | null; sale_end: string | null;
  has_variants: boolean;
  requires_seating: boolean; seating_mode: SeatingMode | null;
}
export interface CatalogSeriesOut {
  id: string; name: string; image_url: string | null;
  sort_order: number; products: CatalogProductOut[];
}
export interface CatalogCategoryOut {
  id: string; name: string; activity_id: string | null; image_url: string | null;
  sort_order: number; series: CatalogSeriesOut[];
}
export interface SelectedOption {
  group_id: string; group_name: string;
  option_id: string; value: string; price_delta: number;
}
export interface CartItemOut {
  id: string; product_id: string; product_name: string;
  product_image_url: string | null;
  quantity: number; unit_price: number; subtotal: number;
  selected_options: SelectedOption[];
  available: boolean; unavailable_reason: string | null;
}
export interface CartOut {
  id: string; items: CartItemOut[]; total_price: number;
}
export interface OrderItemOut {
  id: string; product_id: string; product_name: string | null;
  quantity: number; unit_price: number; subtotal: number;
  selected_options: SelectedOption[];
}
export interface OrderOut {
  id: string; serial_number: string; user_id: string; org_id: string; activity_id: string | null;
  status: OrderStatus; total_price: number; notes: string | null;
  class_id: string | null; class_label: string | null;
  assistance_scope: string; assisted_by_id: string | null;
  is_paid: boolean; paid_at: string | null;
  created_at: string; updated_at: string; items: OrderItemOut[];
}
export interface OrderListItem {
  id: string; serial_number: string; user_id: string;
  user_name: string | null; org_id: string; activity_id: string | null;
  status: OrderStatus; total_price: number;
  class_id: string | null; class_label: string | null;
  assistance_scope: string; assisted_by_id: string | null;
  is_paid: boolean; created_at: string;
}
export interface OrderSummaryRow {
  key: string; label: string;
  order_count: number; item_count: number;
  total_amount: number; paid_amount: number; unpaid_amount: number;
}
export interface OrderSummaryOut {
  group_by: string; rows: OrderSummaryRow[];
  total_amount: number; paid_amount: number; unpaid_amount: number;
}

// ── 劃位 / 票券型別 ──────────────────────────────────────────────────────────
export type SeatingMode = "at_purchase" | "scheduled" | "admin_assign";
export type SeatStatus = "available" | "disabled" | "blocked";
export type SeatAssignmentStatus = "active" | "released";
/** 使用者選位畫面每個座位的即時狀態 */
export type SeatStateKind = "available" | "disabled" | "blocked" | "held" | "mine" | "taken";

export interface SeatInput {
  id?: string | null;
  label: string; block?: string | null; row_label?: string | null;
  x: number; y: number;
  seat_type: string; price_delta: number; status: SeatStatus;
}
export interface SeatOut {
  id: string; zone_id: string;
  label: string; block: string | null; row_label: string | null;
  x: number; y: number;
  seat_type: string; price_delta: number; status: SeatStatus;
}
export interface WaveInput {
  id?: string | null;
  name: string; starts_at: string | null;
  audience: Record<string, unknown>; sort_order: number;
}
export interface WaveOut {
  id: string; zone_id: string;
  name: string; starts_at: string | null;
  audience: Record<string, unknown>; sort_order: number;
}
export interface ZoneOut {
  id: string; product_id: string; name: string; description: string | null;
  starts_at: string | null; seating_opens_at: string | null;
  hold_minutes: number; layout: Record<string, unknown>; sort_order: number;
  seats: SeatOut[]; waves: WaveOut[];
}
export interface ZoneListItem {
  id: string; product_id: string; name: string;
  starts_at: string | null; seating_opens_at: string | null;
  sort_order: number;
  seat_count: number; available_count: number; assigned_count: number;
}
export interface SeatState {
  id: string; label: string; block: string | null; row_label: string | null;
  x: number; y: number; seat_type: string; price_delta: number;
  state: SeatStateKind;
}
export interface SeatMapOut {
  zone_id: string; product_id: string; name: string;
  starts_at: string | null; layout: Record<string, unknown>;
  hold_minutes: number; seats: SeatState[];
  remaining_quota: number; can_select_now: boolean;
  next_open_at: string | null; hold_expires_at: string | null;
}
export interface HoldOut {
  zone_id: string; seat_ids: string[];
  expires_at: string | null; rejected_seat_ids: string[];
}
export interface SeatBookingOut {
  id: string; seat_id: string; seat_label: string | null;
  zone_id: string; zone_name: string | null;
  order_id: string; order_item_id: string | null;
  user_id: string; user_name: string | null;
  assigned_by_id: string | null;
  status: SeatAssignmentStatus; created_at: string;
}

// ── 特約地圖型別 ──────────────────────────────────────────────────────────────

export type PartnerBusinessStatus = "draft" | "active" | "hidden" | "archived";

export interface PartnerTagOut {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PartnerLocationOut {
  id: string;
  business_id: string;
  name: string | null;
  address: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  business_hours: Record<string, unknown>;
  google_place_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PartnerOfferOut {
  id: string;
  business_id: string;
  title: string;
  public_summary: string | null;
  full_description: string | null;
  instructions: string | null;
  member_note: string | null;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  is_active: boolean;
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

export interface PartnerBusinessOut {
  id: string;
  name: string;
  summary: string | null;
  description: string | null;
  website_url: string | null;
  social_url: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  category: string | null;
  business_hours_text: string | null;
  status: PartnerBusinessStatus;
  sort_order: number;
  view_count: number;
  click_count: number;
  checkin_count: number;
  rating_avg: number | null;
  rating_count: number;
  popularity_score: number;
  internal_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  tags: PartnerTagOut[];
  locations: PartnerLocationOut[];
  offers: PartnerOfferOut[];
  can_view_private_details: boolean;
}

export interface PartnerBusinessListItem {
  id: string;
  name: string;
  summary: string | null;
  status: PartnerBusinessStatus;
  logo_url: string | null;
  cover_image_url: string | null;
  category: string | null;
  business_hours_text: string | null;
  sort_order: number;
  view_count: number;
  click_count: number;
  checkin_count: number;
  rating_avg: number | null;
  rating_count: number;
  popularity_score: number;
  tags: PartnerTagOut[];
  location_count: number;
  active_offer_count: number;
  created_at: string;
  updated_at: string;
}

export interface PartnerMapItem {
  business_id: string;
  location_id: string;
  business_name: string;
  location_name: string | null;
  summary: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  category: string | null;
  business_hours_text: string | null;
  address: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  tags: PartnerTagOut[];
  has_active_offer: boolean;
  active_offer_titles: string[];
  rating_avg: number | null;
  rating_count: number;
  popularity_score: number;
  view_count: number;
  checkin_count: number;
}

export interface PartnerBusinessCreate {
  name: string;
  summary?: string | null;
  description?: string | null;
  website_url?: string | null;
  social_url?: string | null;
  logo_url?: string | null;
  cover_image_url?: string | null;
  category?: string | null;
  business_hours_text?: string | null;
  status?: PartnerBusinessStatus;
  sort_order?: number;
  internal_note?: string | null;
  tag_ids?: string[];
}

export type PartnerBusinessUpdate = Partial<PartnerBusinessCreate>;

export interface PartnerTagCreate {
  name: string;
  color?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export type PartnerTagUpdate = Partial<PartnerTagCreate>;

export interface PartnerLocationCreate {
  name?: string | null;
  address: string;
  latitude: number;
  longitude: number;
  phone?: string | null;
  business_hours?: Record<string, unknown>;
  google_place_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export type PartnerLocationUpdate = Partial<PartnerLocationCreate>;

export interface PartnerOfferCreate {
  title: string;
  public_summary?: string | null;
  full_description?: string | null;
  instructions?: string | null;
  member_note?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export type PartnerOfferUpdate = Partial<PartnerOfferCreate>;

export interface PartnerRatingCreate {
  rating: number;
  comment?: string | null;
  visit_count?: number;
  is_public?: boolean;
}

export interface PartnerRatingOut {
  id: string;
  business_id: string;
  user_id: string | null;
  rating: number;
  comment: string | null;
  visit_count: number;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface PartnerSubmissionCreate {
  name: string;
  category?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  reason?: string | null;
  offer_hint?: string | null;
  contact_hint?: string | null;
}

export type PartnerSubmissionStatus = "pending" | "approved" | "rejected";

export interface PartnerSubmissionOut {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  reason: string | null;
  offer_hint: string | null;
  contact_hint: string | null;
  status: PartnerSubmissionStatus;
  submitted_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  business_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerRankingItem {
  business_id: string;
  name: string;
  summary: string | null;
  category: string | null;
  logo_url: string | null;
  rating_avg: number | null;
  rating_count: number;
  checkin_count: number;
  view_count: number;
  popularity_score: number;
}

// ── 班級系統型別 ──────────────────────────────────────────────────────────────

export interface ClassStudentRangeOut {
  id: string; class_id: string;
  student_id_start: string; student_id_end: string;
}
export interface ClassStudentRangeTemplate {
  student_id_start_template: string;
  student_id_end_template: string;
  student_no_start: number;
  student_no_end: number;
  class_no_width: number;
  student_no_width: number;
}
export interface ClassStudentRangeOverride {
  class_no: number;
  student_no_start: number | null;
  student_no_end: number | null;
}
export interface SchoolClassBulkGradeCreate {
  grade: number;
  class_start: number;
  class_end: number;
  class_code_template: string;
  label_template: string | null;
  range_template: ClassStudentRangeTemplate | null;
  class_overrides: ClassStudentRangeOverride[];
}
export interface SchoolClassBulkCreate {
  academic_year: number;
  is_active: boolean;
  grades: SchoolClassBulkGradeCreate[];
}
export interface SchoolClassBulkCreateResult {
  class_code: string;
  label: string | null;
  ok: boolean;
  class_id: string | null;
  detail: string | null;
}
export interface SchoolClassBulkCreateOut {
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  results: SchoolClassBulkCreateResult[];
}
export type SchoolClassBulkActionKind = "activate" | "deactivate" | "delete";
export interface SchoolClassBulkActionResult {
  class_id: string;
  label: string | null;
  ok: boolean;
  detail: string | null;
}
export interface SchoolClassBulkActionOut {
  total: number;
  succeeded: number;
  failed: number;
  results: SchoolClassBulkActionResult[];
}
export interface ClassUserBrief {
  id: string; display_name: string; student_id: string | null; email: string;
}
export interface ClassCadreOut {
  id: string; class_id: string; user_id: string;
  user: ClassUserBrief | null;
}
export interface ClassManualMemberOut {
  id: string; class_id: string; user_id: string;
  user: ClassUserBrief | null;
}
export interface ClassMembershipOut {
  id: string;
  class_id: string;
  user_id: string;
  academic_year: number;
  source: string;
  status: string;
  start_date: string;
  end_date: string | null;
  user: ClassUserBrief | null;
}
export interface ClassRoleBindingOut {
  id: string;
  class_id: string;
  role_key: string;
  position_id: string;
}
export interface ClassRoleHolderOut {
  user_position_id: string;
  user_id: string;
  display_name: string;
  email: string;
  student_id: string | null;
  start_date: string;
  end_date: string | null;
}
export interface ClassRoleOut extends ClassRoleBindingOut {
  label: string;
  permission_codes: string[];
  holders: ClassRoleHolderOut[];
}
export interface SchoolClassListItem {
  id: string; academic_year: number; class_code: string;
  grade: number; label: string | null; is_active: boolean;
}
export interface SchoolClassOut extends SchoolClassListItem {
  created_by: string; org_id: string | null; created_at: string; updated_at: string;
  ranges: ClassStudentRangeOut[];
  cadres: ClassCadreOut[];
  memberships: ClassMembershipOut[];
  role_bindings: ClassRoleBindingOut[];
}
export interface ClassMemberOut {
  id: string; display_name: string;
  student_id: string | null; email: string; is_cadre: boolean;
  source: "range" | "manual" | "person_affiliation";
  manual_member_id: string | null;
}

// ── 人員與身分總表 ────────────────────────────────────────────────────────────

export type PersonStatus = "active" | "alumni" | "transferred" | "inactive";
export type PersonAffiliationKind = "student" | "class_member" | "class_role" | "org_position";
export type PersonAffiliationStatus = "active" | "ended" | "pending_user";
export type PersonAffiliationSource = "manual" | "import" | "class_workspace" | "rbac_sync";

export interface PersonOut {
  id: string;
  user_id: string | null;
  student_id: string | null;
  display_name: string;
  legal_name: string | null;
  email: string | null;
  status: PersonStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonListItem extends PersonOut {
  active_affiliation_count: number;
  class_labels: string[];
  role_titles: string[];
}

export interface PersonAffiliationOut {
  id: string;
  person_id: string;
  kind: PersonAffiliationKind;
  academic_year: number | null;
  class_id: string | null;
  class_label: string | null;
  org_id: string | null;
  org_name: string | null;
  position_id: string | null;
  position_name: string | null;
  role_key: string | null;
  title: string | null;
  start_date: string;
  end_date: string | null;
  status: PersonAffiliationStatus;
  source: PersonAffiliationSource;
  synced_user_position_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonDetailOut extends PersonOut {
  affiliations: PersonAffiliationOut[];
}

export type PersonCreate = Pick<
  PersonOut,
  "display_name" | "student_id" | "legal_name" | "email" | "status" | "note"
> & { user_id?: string | null };

export type PersonUpdate = Partial<PersonCreate>;

export interface PersonAffiliationCreate {
  person_id: string;
  kind: PersonAffiliationKind;
  academic_year?: number | null;
  class_id?: string | null;
  org_id?: string | null;
  position_id?: string | null;
  role_key?: string | null;
  title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  source?: PersonAffiliationSource;
  note?: string | null;
}

export type PersonAffiliationUpdate = Partial<
  Pick<PersonAffiliationOut, "start_date" | "end_date" | "status" | "title" | "note">
>;

export interface PersonRosterImportRow {
  student_id: string;
  display_name: string;
  email?: string | null;
  class_id?: string | null;
  academic_year?: number | null;
  note?: string | null;
}

export interface PersonRosterImportResult {
  total: number;
  people_created: number;
  people_updated: number;
  affiliations_created: number;
  skipped: number;
}

// ── 法規系統型別 ──────────────────────────────────────────────────────────────

/** 法規分類（對應後端 RegulationCategory enum） */
export type RegulationCategory =
  | "constitution"       // 憲章
  | "ordinance"          // 條例
  | "procedure";         // 辦法

/** 條文層級（Volume > Chapter > Section > Article > Paragraph > Subparagraph > Item） */
export type ArticleType =
  | "volume"         // 編
  | "chapter"        // 章
  | "section"        // 節
  | "article"        // 條（新）
  | "paragraph"      // 項（新）
  | "subparagraph"   // 款（新）
  | "item"           // 目（新）
  | "special_clause"; // 特殊條文（如附則）

/** 結構化條文 */
export interface RegulationArticleOut {
  id: string;
  regulation_id: string;
  /** 沿革識別碼：同一條文跨版本（修正案）保持穩定 */
  lineage_id: string;
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
  /** 血緣鏈：若由既有法規 fork 而來，記錄原始法規 ID */
  source_regulation_id: string | null;
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

/** 全文搜尋結果：RegulationListItem 加上命中的條文 */
export interface RegulationSearchResult extends RegulationListItem {
  matched_articles: RegulationArticleOut[];
}

export interface AmendmentComparisonRow {
  article_key: string;
  status: string;
  revised_text: string;
  current_text: string;
  note: string;
}

// ── 議事系統型別 ──────────────────────────────────────────────────────────────

export type MeetingStatus =
  | "draft"
  | "confirmed"
  | "checkin"
  | "active"
  | "break"
  | "paused"
  | "closed"
  | "archived";
/** 會議的法案審議階段（決定議程自動帶入哪一階段的法案） */
export type MeetingBillStage = "standing_committee" | "council";

export type MeetingMode = "simple" | "full";

export type MeetingVoteRecordMethod = "ballots" | "tally" | "acclamation";

export interface MeetingVoteOption {
  key: string;
  label: string;
}

export interface MeetingRecusalOut {
  id: string;
  agenda_item_id: string;
  user_id: string;
  note: string | null;
  created_by: string;
  created_at: string;
  user: MeetingUserBrief | null;
}
export type AgendaItemType = "manual" | "regulation" | "document" | "council_proposal";
export type AttendanceRole = "voter" | "attendee" | "observer";
export type AttendanceStatus = "expected" | "present" | "absent" | "leave";
export type VoteStatus = "draft" | "open" | "closed";
export type VoteVisibility = "named" | "anonymous";
export type VoteThresholdType =
  | "simple_majority"
  | "present_majority"
  | "all_members_majority"
  | "custom";
export type BallotChoice = "approve" | "reject" | "abstain";
export type MeetingRequestType = "speech" | "point_of_order" | "privilege";
export type MeetingRequestStatus = "pending" | "acknowledged" | "dismissed";
export type AttendanceSourceType =
  | "class_cadres"
  | "class_members"
  | "org_members"
  | "position_members"
  | "manual";
export type MeetingArtifactType =
  | "activity"
  | "regulation"
  | "document"
  | "survey"
  | "announcement"
  | "petition"
  | "judicial_petition"
  | "council_proposal"
  | "shop"
  | "shop_order"
  | "meal"
  | "meal_order"
  | "meal_schedule"
  | "external"
  | "custom";
export type MeetingMotionType = "main" | "amendment" | "procedural";
export type MeetingMotionStatus =
  | "pending"
  | "debating"
  | "voting"
  | "adopted"
  | "rejected"
  | "withdrawn";
export type MeetingDecisionStatus = "draft" | "passed" | "failed" | "recorded";
export type MeetingScreenReadingMode =
  | "agenda"
  | "speaker"
  | "vote"
  | "result"
  | "break"
  | "announcement"
  | "document"
  | "article"
  | "attachment"
  | "free_text";
export type MeetingSpeechQueueStatus =
  | "queued"
  | "speaking"
  | "paused"
  | "finished"
  | "skipped"
  | "cancelled";
export type MeetingTimerStatus = "idle" | "running" | "paused" | "overtime";

export interface MeetingUserBrief {
  id: string;
  display_name: string;
  email: string;
  student_id: string | null;
}

export interface MeetingClassBrief {
  id: string;
  class_code: string;
  label: string | null;
  grade: number | null;
}

/** 議程項目關聯法規（修正案）的精簡資訊 */
export interface MeetingRegulationBrief {
  id: string;
  title: string;
  category: RegulationCategory;
  version: number;
  workflow_status: RegulationWorkflowStatus;
  amendment_type: RegulationAmendmentType;
  source_regulation_id: string | null;
}

export interface MeetingAgendaItemOut {
  id: string;
  meeting_id: string;
  title: string;
  description: string | null;
  item_type: AgendaItemType;
  order_index: number;
  regulation_id: string | null;
  document_id: string | null;
  council_proposal_id: string | null;
  notes: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
  regulation: MeetingRegulationBrief | null;
  attachments: MeetingAgendaAttachmentOut[];
  artifact_links: MeetingArtifactLinkOut[];
  recusals: MeetingRecusalOut[];
}

export interface MeetingAgendaAttachmentOut {
  id: string;
  agenda_item_id: string;
  filename: string;
  display_name: string | null;
  content_type: string | null;
  file_size: number | null;
  url: string;
  link_url: string | null;
  uploaded_by: string;
  created_at: string;
}

export interface MeetingArtifactLinkOut {
  id: string;
  agenda_item_id: string;
  artifact_type: MeetingArtifactType;
  object_id: string | null;
  title: string;
  url: string | null;
  summary: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MeetingAttendanceOut {
  id: string;
  meeting_id: string;
  user_id: string;
  role: AttendanceRole;
  status: AttendanceStatus;
  checked_in_at: string | null;
  is_voting_eligible: boolean;
  voting_class_id: string | null;
  proxy_for_user_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  user: MeetingUserBrief | null;
  voting_class: MeetingClassBrief | null;
  proxy_for_user: MeetingUserBrief | null;
}

export interface MeetingAttendanceSourceOut {
  id: string;
  meeting_id: string;
  source_type: AttendanceSourceType;
  source_id: string | null;
  label: string;
  role: AttendanceRole;
  is_voting_eligible: boolean;
  imported_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MeetingAttendanceSourcePreviewOut {
  source_type: AttendanceSourceType;
  source_id: string | null;
  label: string;
  members: MeetingUserBrief[];
  count: number;
}

export interface MeetingVoteTallyOut {
  approve: number;
  reject: number;
  abstain: number;
  total: number;
  eligible: number;
  pass_threshold: number;
  threshold_type: VoteThresholdType;
  passed: boolean;
  option_counts: Record<string, number>;
  result_label: string | null;
}

export interface MeetingBallotOut {
  id: string;
  vote_id: string;
  voter_id: string;
  choice: BallotChoice;
  option_key: string | null;
  cast_at: string;
  voter: MeetingUserBrief | null;
}

export interface MeetingVoteOut {
  id: string;
  meeting_id: string;
  agenda_item_id: string | null;
  title: string;
  description: string | null;
  visibility: VoteVisibility;
  status: VoteStatus;
  pass_threshold: number;
  threshold_type: VoteThresholdType;
  record_method: MeetingVoteRecordMethod;
  options: MeetingVoteOption[] | null;
  manual_tally: Record<string, number> | null;
  result_label: string | null;
  opened_at: string | null;
  closed_at: string | null;
  result_note: string | null;
  created_at: string;
  updated_at: string;
  tally: MeetingVoteTallyOut | null;
  ballots: MeetingBallotOut[];
}

export type MeetingVoteRosterStatus =
  | "approve"
  | "reject"
  | "abstain"
  | "not_voted"
  | "mixed";

export interface MeetingVoteRosterClassOut {
  class_id: string | null;
  class_code: string;
  label: string;
  grade: number | null;
  eligible: number;
  present: number;
  approve: number;
  reject: number;
  abstain: number;
  not_voted: number;
  status: MeetingVoteRosterStatus;
}

export interface MeetingVoteRosterOut {
  classes: MeetingVoteRosterClassOut[];
  unassigned: MeetingVoteRosterClassOut | null;
}

export interface MeetingRequestOut {
  id: string;
  meeting_id: string;
  user_id: string;
  request_type: MeetingRequestType;
  status: MeetingRequestStatus;
  agenda_item_id: string | null;
  content: string | null;
  created_at: string;
  updated_at: string;
  user: MeetingUserBrief | null;
}

export interface MeetingSpeechQueueItemOut {
  id: string;
  meeting_id: string;
  agenda_item_id: string | null;
  user_id: string | null;
  request_id: string | null;
  speaker_name: string;
  speaker_role: string | null;
  status: MeetingSpeechQueueStatus;
  order_index: number;
  duration_seconds: number;
  remaining_seconds: number;
  started_at: string | null;
  paused_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  user: MeetingUserBrief | null;
}

export interface MeetingTimerStateOut {
  meeting_id: string;
  active_speech_id: string | null;
  status: MeetingTimerStatus;
  server_started_at: string | null;
  duration_seconds: number;
  remaining_when_paused: number;
  updated_at: string | null;
}

export interface MeetingMotionOut {
  id: string;
  meeting_id: string;
  agenda_item_id: string | null;
  proposer_id: string | null;
  motion_type: MeetingMotionType;
  title: string;
  content: string | null;
  status: MeetingMotionStatus;
  vote_id: string | null;
  created_at: string;
  updated_at: string;
  proposer: MeetingUserBrief | null;
}

export interface MeetingDecisionOut {
  id: string;
  meeting_id: string;
  agenda_item_id: string;
  motion_id: string | null;
  vote_id: string | null;
  title: string;
  content: string;
  status: MeetingDecisionStatus;
  regulation_transition_to: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MeetingScreenStateOut {
  meeting_id: string;
  agenda_item_id: string | null;
  reading_mode: MeetingScreenReadingMode;
  title: string | null;
  body: string | null;
  active_attachment_id: string | null;
  scroll_position: number;
  auto_scroll: boolean;
  scroll_speed: number;
  is_fullscreen: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

export interface MeetingEventOut {
  id: string;
  meeting_id: string;
  agenda_item_id: string | null;
  event_type: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface MeetingListItem {
  id: string;
  org_id: string;
  activity_id: string | null;
  title: string;
  mode: MeetingMode;
  location: string | null;
  chair_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: MeetingStatus;
  expected_voters: number;
  quorum_count: number;
  default_pass_threshold: number;
  default_speech_seconds: number;
  allow_observer_requests: boolean;
  bill_stage: MeetingBillStage | null;
  current_agenda_item_id: string | null;
  screen_focus_title: string | null;
  screen_focus_body: string | null;
  confirmed_at: string | null;
  notice_document_id: string | null;
  created_at: string;
}

export interface MeetingOut extends MeetingListItem {
  description: string | null;
  reminder_sent_at: string | null;
  screen_token: string;
  checkin_token: string;
  agenda_items: MeetingAgendaItemOut[];
  attendance_records: MeetingAttendanceOut[];
  attendance_sources: MeetingAttendanceSourceOut[];
  votes: MeetingVoteOut[];
  requests: MeetingRequestOut[];
  speech_queue: MeetingSpeechQueueItemOut[];
  timer_state: MeetingTimerStateOut | null;
  motions: MeetingMotionOut[];
  decisions: MeetingDecisionOut[];
  screen_state: MeetingScreenStateOut | null;
  events: MeetingEventOut[];
}

export interface MeetingScreenOut {
  meeting: MeetingOut;
  current_agenda_item: MeetingAgendaItemOut | null;
  active_vote: MeetingVoteOut | null;
  attendance_summary: Record<string, number>;
  screen_state: MeetingScreenStateOut | null;
  vote_roster: MeetingVoteRosterOut | null;
  active_speech: MeetingSpeechQueueItemOut | null;
  speech_queue: MeetingSpeechQueueItemOut[];
  timer_state: MeetingTimerStateOut | null;
}

export interface MeetingJoinOut {
  meeting: MeetingOut;
  current_agenda_item: MeetingAgendaItemOut | null;
  attendance: MeetingAttendanceOut | null;
  is_rostered: boolean;
  can_vote: boolean;
  active_vote: MeetingVoteOut | null;
  my_ballot: MeetingBallotOut | null;
  my_speech_queue_items: MeetingSpeechQueueItemOut[];
  active_speech: MeetingSpeechQueueItemOut | null;
  timer_state: MeetingTimerStateOut | null;
}

export interface MeetingWorkspaceOut {
  today: MeetingListItem[];
  drafts: MeetingListItem[];
  active: MeetingListItem[];
  closing_pending: MeetingListItem[];
}

export interface MeetingMinutesOut {
  meeting: MeetingOut;
  attendance_summary: Record<string, number>;
  agenda_items: MeetingAgendaItemOut[];
  votes: MeetingVoteOut[];
  events: MeetingEventOut[];
  markdown: string;
}

// ── 行事曆型別 ────────────────────────────────────────────────────────────────

export type CalendarEventType =
  | "activity"
  | "preparation"
  | "rehearsal"
  | "interschool_meeting"
  | "formal_meeting"
  | "deadline"
  | "other";
export type CalendarEventStatus = "tentative" | "confirmed" | "cancelled" | "done";
export type CalendarVisibility = "private" | "participants" | "org" | "logged_in" | "public";
export type CalendarParticipantRole = "owner" | "organizer" | "required" | "optional";
export type CalendarParticipantResponse = "pending" | "accepted" | "declined" | "tentative";
export type CalendarLinkType =
  | "document"
  | "meeting"
  | "survey"
  | "announcement"
  | "external"
  | "custom";

export interface CalendarUserBrief {
  id: string;
  display_name: string;
  email: string;
  student_id: string | null;
}

export interface CalendarParticipantCreate {
  user_id: string;
  role?: CalendarParticipantRole;
  response?: CalendarParticipantResponse;
}

export interface CalendarParticipantOut {
  id: string;
  event_id: string;
  user_id: string;
  role: CalendarParticipantRole;
  response: CalendarParticipantResponse;
  created_at: string;
  updated_at: string;
  user: CalendarUserBrief | null;
}

export interface CalendarChecklistCreate {
  title: string;
  due_at?: string | null;
  assignee_id?: string | null;
}

export interface CalendarChecklistOut {
  id: string;
  event_id: string;
  title: string;
  due_at: string | null;
  assignee_id: string | null;
  is_done: boolean;
  done_at: string | null;
  created_at: string;
  updated_at: string;
  assignee: CalendarUserBrief | null;
}

export interface CalendarLinkCreate {
  link_type: CalendarLinkType;
  object_id?: string | null;
  title: string;
  url?: string | null;
}

export interface CalendarLinkOut {
  id: string;
  event_id: string;
  link_type: CalendarLinkType;
  object_id: string | null;
  title: string;
  url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventCreate {
  org_id: string;
  title: string;
  description?: string | null;
  event_type?: CalendarEventType;
  status?: CalendarEventStatus;
  visibility?: CalendarVisibility;
  location?: string | null;
  starts_at: string;
  ends_at?: string | null;
  all_day?: boolean;
  participants?: CalendarParticipantCreate[];
  checklist_items?: CalendarChecklistCreate[];
  links?: CalendarLinkCreate[];
}

export interface CalendarEventListItem {
  id: string;
  org_id: string | null;
  title: string;
  description: string | null;
  event_type: CalendarEventType;
  status: CalendarEventStatus;
  visibility: CalendarVisibility;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  source_meeting_id: string | null;
  source_module: string | null;
  source_id: string | null;
  source_key: string | null;
  href: string | null;
  created_by: string;
  updated_by: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventOut extends CalendarEventListItem {
  participants: CalendarParticipantOut[];
  checklist_items: CalendarChecklistOut[];
  links: CalendarLinkOut[];
}

// ── 活動系統 ──────────────────────────────────────────────────────────────────

export type ActivityStatus = "draft" | "active" | "ended" | "archived";

export interface Activity {
  id: string;
  name: string;
  description: string | null;
  org_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: ActivityStatus;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ActivityCreate {
  name: string;
  description?: string | null;
  org_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: ActivityStatus;
}

export interface ActivityLinkCreate {
  target_type: ActivityLinkKind;
  target_id: string;
  title: string;
  href: string;
  note?: string | null;
  meta?: Record<string, unknown>;
}

export interface ActivityConvener {
  id: string;
  activity_id: string;
  user_id: string;
  start_date: string;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  user_name: string;
  user_email: string;
}

// ── 跨模組工作流 ──────────────────────────────────────────────────────────────

export interface WorkflowTransitionCreate {
  status: string;
  note?: string | null;
  payload?: Record<string, unknown>;
}

export interface WorkflowLinkCreate {
  target_type: string;
  target_id?: string | null;
  relation?: string;
  title: string;
  href?: string | null;
  note?: string | null;
  meta?: Record<string, unknown>;
}

export interface WorkflowLinkOut {
  id: string;
  instance_id: string;
  target_type: string;
  target_id: string | null;
  relation: string;
  title: string;
  href: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowEventOut {
  id: string;
  instance_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_id: string | null;
  actor_email: string | null;
  note: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface WorkflowInstanceOut {
  id: string;
  workflow_type: string;
  source_type: string;
  source_id: string;
  title: string;
  status: string;
  current_step: string | null;
  org_id: string | null;
  activity_id: string | null;
  created_by_id: string | null;
  completed_at: string | null;
  is_active: boolean;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  links: WorkflowLinkOut[];
}

export interface WorkflowTimelineOut {
  instance: WorkflowInstanceOut;
  events: WorkflowEventOut[];
  links: WorkflowLinkOut[];
}

export type ActivityLinkKind =
  | "announcement" | "survey" | "shop_product" | "shop_order"
  | "meal_schedule" | "meal_order" | "meeting" | "document"
  | "regulation" | "petition" | "council_proposal" | "judicial_petition"
  | "work_item" | "receivable" | "publication";

export interface ActivityLinkOut {
  id: string;
  activity_id: string;
  target_type: ActivityLinkKind;
  target_id: string;
  title: string;
  href: string;
  note: string | null;
  meta: Record<string, unknown>;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityLinkSuggestion {
  suggestion_id: string;
  target_type: ActivityLinkKind;
  target_id: string;
  title: string;
  href: string;
  score: number;
  reasons: string[];
  meta: Record<string, unknown>;
}

export interface ActivityWorkspaceOut {
  activity_id: string;
  sections: Array<{ key: string; title: string; count: number; items: ActivityLinkOut[] }>;
  pending_items: Array<Record<string, unknown>>;
  checklist: Array<{ key: string; title: string; status: string; action: string }>;
  suggestions: ActivityLinkSuggestion[];
}

export interface ActivityClosingReportOut {
  activity_id: string;
  linked_counts: Record<string, number>;
  receivables: Record<string, number>;
  tasks: Record<string, number>;
  publications: Record<string, number>;
  generated_at: string;
}

export type ReceivableStatus = "unpaid" | "partial" | "paid" | "refunding" | "refunded" | "canceled";
export type ReceivableSource = "shop_order" | "meal_order" | "activity_fee" | "class_fee" | "manual";

export interface ReceivableOut {
  id: string;
  source_type: ReceivableSource;
  source_id: string | null;
  activity_id: string | null;
  org_id: string | null;
  user_id: string | null;
  class_id: string | null;
  title: string;
  amount: number;
  paid_amount: number;
  refunded_amount: number;
  status: ReceivableStatus;
  collected_by_id: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  due_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReceivableSummaryOut {
  total_count: number;
  total_amount: number;
  paid_amount: number;
  unpaid_amount: number;
  refunded_amount: number;
  by_status: Record<string, number>;
}

export type PublicationStatus = "draft" | "scheduled" | "sent" | "canceled";

export interface PublicationCampaignOut {
  id: string;
  title: string;
  body: string;
  source_type: string | null;
  source_id: string | null;
  activity_id: string | null;
  org_id: string | null;
  audience_type: string;
  audience_filter: Record<string, unknown>;
  channels: string[];
  status: PublicationStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicationPreviewOut {
  title: string;
  channels: Record<string, { title: string; body: string }>;
  estimated_recipients: number;
}

export interface PublicationStatsOut {
  campaign_id: string;
  total_deliveries: number;
  by_channel: Record<string, number>;
  by_status: Record<string, number>;
}

export interface ContextLink {
  title: string;
  href: string;
  kind: string;
  timestamp: string | null;
}

export interface MeetingBriefingCardOut {
  meeting_id: string;
  my_role: string | null;
  attendance_status: string | null;
  agenda_items: ContextLink[];
  related_items: ContextLink[];
  recommended_actions: string[];
}

export interface DocumentApprovalContextOut {
  document_id: string;
  source_activity: ContextLink | null;
  related_items: ContextLink[];
  previous_comments: string[];
  recommended_actions: string[];
}

export interface PetitionResolutionContextOut {
  petition_id: string;
  related_regulations: ContextLink[];
  similar_petitions: ContextLink[];
  related_activities: ContextLink[];
  recommended_actions: string[];
}

export interface RegulationUsageContextOut {
  regulation_id: string;
  related_documents: ContextLink[];
  related_meetings: ContextLink[];
  related_petitions: ContextLink[];
  related_announcements: ContextLink[];
  pending_reviews: ContextLink[];
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
  allow_external_login: boolean;
  is_superuser: boolean;
  /** Owner 為 OWNER_EMAILS 環境變數驅動的最高權限角色，由路由層注入 */
  is_owner: boolean;
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
  student_id?: string | null;
}

export interface OrgRead {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  leader_user_id: string | null;
  prefix: string | null;
  bill_stage: MeetingBillStage | null;
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
  position_category: PositionCategory;
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

export type PositionCategory = "council" | "class" | "system";

export interface PositionSummary {
  id: string;
  name: string;
  org_id: string;
  org_name: string;
  org_is_active: boolean;
  description?: string | null;
  category: PositionCategory;
  weight: number;
  parent_id?: string | null;
  permission_codes: string[];
  user_position_id?: string | null;
}

export interface AdminUserDetail {
  id: string;
  email: string;
  linked_emails: string[];
  display_name: string;
  student_id: string | null;
  avatar_url: string | null;
  is_active: boolean;
  allow_external_login: boolean;
  is_superuser: boolean;
  /** Owner 為 OWNER_EMAILS 環境變數驅動的最高權限角色 */
  is_owner: boolean;
  created_at: string;
  positions: PositionSummary[];
  effective_permissions: string[];
}

export interface UserBatchPreRegisterResult {
  total: number;
  created: number;
  failed: number;
  results: {
    index: number;
    success: boolean;
    display_name: string;
    email: string | null;
    student_id: string | null;
    user_id: string | null;
    error: string | null;
  }[];
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

export type MealOrderStatus = "pending" | "confirmed" | "cancelled" | "completed";

export interface MealVendorOut {
  id: string;
  name: string;
  description: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  is_active: boolean;
  status: string;
  review_note: string | null;
  org_id: string;
  activity_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MealVendorApplicationOut {
  id: string;
  name: string;
  description: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  org_id: string;
  status: string;
  review_note: string | null;
  reviewed_by_id: string | null;
  reviewed_at: string | null;
  vendor_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MealProductOut {
  id: string;
  vendor_id: string;
  name: string;
  description: string | null;
  category: string | null;
  image_url: string | null;
  price: number;
  default_max_quantity: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MealPickupSlotOut {
  id: string;
  availability_id: string;
  label: string;
  sort_order: number;
  pickup_start: string;
  pickup_end: string;
  order_deadline: string;
  capacity: number | null;
  is_active: boolean;
}

export interface MealAvailabilityOut {
  id: string;
  product_id: string;
  vendor_id: string;
  service_date: string;
  sale_start: string | null;
  sale_end: string | null;
  price: number;
  max_quantity: number | null;
  is_available: boolean;
  note: string | null;
  product: MealProductOut | null;
  pickup_slots: MealPickupSlotOut[];
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
  menu_item_id: string | null;
  availability_id: string | null;
  product_name_snapshot: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface MealOrderOut {
  id: string;
  serial_number: string;
  pickup_code: string;
  user_id: string;
  schedule_id: string | null;
  vendor_id: string;
  availability_id: string | null;
  pickup_slot_id: string | null;
  class_id: string | null;
  assistance_scope: string;
  assisted_by_id: string | null;
  status: MealOrderStatus;
  total_price: number;
  is_paid: boolean;
  paid_at: string | null;
  pickup_status: string;
  pickup_at: string | null;
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
  schedule_id: string | null;
  vendor_id: string;
  pickup_slot_id: string | null;
  class_id: string | null;
  assistance_scope: string;
  assisted_by_id: string | null;
  status: MealOrderStatus;
  total_price: number;
  is_paid: boolean;
  pickup_status: string;
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

export interface MealClassPickupCodeOut {
  code: string;
  class_id: string;
  vendor_id: string;
  pickup_slot_id: string;
  expires_at: string | null;
  order_count: number;
}

export interface MealPickupLookupOut {
  kind: string;
  code: string;
  matched_orders: number;
  completed_orders: number;
  total_price: number;
  message: string;
}

// ── 問卷系統型別 ──────────────────────────────────────────────────────────────

export type SurveyStatus = "draft" | "open" | "closed" | "archived";
export type QuestionType =
  | "text"
  | "textarea"
  | "single"
  | "multiple"
  | "ranking"
  | "rating"
  | "date"
  | "section_text"
  | "page_break"
  | "image"
  | "video";

/** 選項額外設定：多選互斥／自由輸入 */
export interface OptionConfig {
  exclusive: string[];
  other: string[];
}

/** 文字題型的格式驗證規則 */
export type ValidationRule = "email" | "number" | "integer" | "url" | "phone";

/** 單一條件判斷規則 */
export interface ConditionRule {
  question_id: string;
  operator: "equals" | "contains";
  value: string;
  /** 與前一條規則的連接方式（第一條忽略） */
  connector: "and" | "or";
}

/** 題目顯示條件：多條規則由上到下依序左結合評估 */
export interface QuestionCondition {
  rules: ConditionRule[];
}

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
  image_url: string | null;
  min_length: number | null;
  max_length: number | null;
  validation_rule: ValidationRule | null;
  min_label: string | null;
  max_label: string | null;
  condition: QuestionCondition | null;
  option_config: OptionConfig | null;
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
  activity_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  questions: SurveyQuestionOut[];
  response_count: number;
  is_public: boolean;
  allowed_org_ids: string[];
  allowed_user_ids: string[];
  allowed_domains: string[];
}

export interface SurveyListItem {
  id: string;
  title: string;
  status: SurveyStatus;
  is_anonymous: boolean;
  opens_at: string | null;
  closes_at: string | null;
    org_id: string;
    activity_id?: string | null;
  created_by: string;
  created_at: string;
  response_count: number;
}

export interface SurveyAnswerOut {
  id: string;
  question_id: string;
  answer_text: string | null;
  answer_options: string[];
  other_text: string | null;
}

export interface SurveyResponseOut {
  id: string;
  survey_id: string;
  submitted_at: string;
  answers: SurveyAnswerOut[];
}

/** 後台檢視用的單筆填答記錄（含填答者 email） */
export interface SurveyResponseAdminItem {
  id: string;
  submitted_at: string;
  respondent_email: string | null;
  answers: SurveyAnswerOut[];
}

export interface QuestionStats {
  question_id: string;
  question_text: string;
  question_type: QuestionType;
  total_responses: number;
  option_counts: Record<string, number>;
  text_answers: string[];
  average_rating: number | null;
  suggested_chart: string;
  available_charts: string[];
}

export interface SurveyStats {
  survey_id: string;
  title: string;
  total_responses: number;
  questions: QuestionStats[];
}

// ── 公告系統型別 ──────────────────────────────────────────────────────────────

/** 公告對象：all=全體 / school=全體竹中生 / orgs=特定組織 / members=特定成員 */
export type AnnouncementAudience = "all" | "school" | "orgs" | "members";

/** 公告對象（組織或成員）的精簡顯示用結構 */
export interface AnnouncementAudienceRef {
  id: string;
  name: string;
}

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
  activity_id: string | null;
  author_id: string;
  author_name: string;
  created_at: string;
  updated_at: string;
  media: AnnouncementMediaOut[];
  audience_type: AnnouncementAudience;
  audience_orgs: AnnouncementAudienceRef[];
  audience_members: AnnouncementAudienceRef[];
}

export interface AnnouncementListItem {
  id: string;
  title: string;
  is_urgent: boolean;
  is_published: boolean;
  published_at: string | null;
  org_id: string | null;
  activity_id: string | null;
  author_id: string;
  author_name: string;
  created_at: string;
  audience_type: AnnouncementAudience;
}

export interface AnnouncementCreate {
  title: string;
  content: Record<string, unknown>;
  is_urgent?: boolean;
  urgent_until?: string | null;
  org_id?: string | null;
  activity_id?: string | null;
  audience_type?: AnnouncementAudience;
  audience_org_ids?: string[];
  audience_user_ids?: string[];
}

export interface AnnouncementUpdate {
  title?: string;
  content?: Record<string, unknown>;
  is_urgent?: boolean;
  urgent_until?: string | null;
  is_published?: boolean;
  activity_id?: string | null;
  audience_type?: AnnouncementAudience;
  audience_org_ids?: string[];
  audience_user_ids?: string[];
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

// ── 議會提案 ───────────────────────────────────────────────────────────────

export type CouncilProposalKind = RegulationAmendmentType;

export type CouncilProposalCaseType =
  | "regulation"
  | "finance"
  | "recall"
  | "impeachment"
  | "personnel"
  | "resolution";

export type CouncilProposalStatus =
  | "submitted"
  | "committee_review"
  | "scheduled"
  | "council_review"
  | "passed"
  | "rejected"
  | "withdrawn"
  | "published";

export interface CouncilProposalCreate {
  contact_name?: string | null;
  contact_email: string;
  proposer_name: string;
  co_sponsors?: string | null;
  case_type: CouncilProposalCaseType;
  kind?: CouncilProposalKind | null;
  regulation_id?: string | null;
  title: string;
  summary: string;
  legal_basis?: string | null;
  proposal_text: string;
  rationale: string;
  expected_effect?: string | null;
}

export interface CouncilProposalListItem {
  id: string;
  serial_number: string;
  submitter_id: string | null;
  proposer_name: string;
  case_type: CouncilProposalCaseType;
  kind: CouncilProposalKind | null;
  regulation_id: string | null;
  regulation_title: string | null;
  title: string;
  summary: string;
  status: CouncilProposalStatus;
  scheduled_at: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CouncilProposalOut extends CouncilProposalListItem {
  contact_name: string | null;
  contact_email: string;
  co_sponsors: string | null;
  legal_basis: string | null;
  proposal_text: string;
  rationale: string;
  expected_effect: string | null;
  committee_review_note: string | null;
  scheduled_meeting_id: string | null;
}

export interface CouncilProposalEligibleMeeting {
  id: string;
  title: string;
  status: string;
  bill_stage: string | null;
  starts_at: string | null;
  already_scheduled: boolean;
}

// ── 評議委員會訴訟 ───────────────────────────────────────────────────────

export type JudicialPetitionType =
  | "constitutional_norm_review"
  | "org_dispute"
  | "election_dispute"
  | "disciplinary_appeal"
  | "other";

export type JudicialPetitionStatus =
  | "submitted"
  | "docketing_review"
  | "accepted"
  | "in_review"
  | "decided"
  | "dismissed"
  | "withdrawn"
  | "published";

export interface JudicialPetitionCreate {
  petitioner_name: string;
  petitioner_email: string;
  representative?: string | null;
  respondent?: string | null;
  petition_type: JudicialPetitionType;
  title: string;
  challenged_norm: string;
  constitutional_provisions: string;
  petition_claim: string;
  facts_and_reasons: string;
  evidence?: string | null;
  attachments_description?: string | null;
}

export interface JudicialPetitionListItem {
  id: string;
  docket_number: string;
  submitter_id: string | null;
  petitioner_name: string;
  petition_type: JudicialPetitionType;
  title: string;
  status: JudicialPetitionStatus;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JudicialPetitionOut extends JudicialPetitionListItem {
  petitioner_email: string;
  representative: string | null;
  respondent: string | null;
  challenged_norm: string;
  constitutional_provisions: string;
  petition_claim: string;
  facts_and_reasons: string;
  evidence: string | null;
  attachments_description: string | null;
  docketing_note: string | null;
  decision_summary: string | null;
}

// ── 通知偏好（站內 / Email 多管道）──────────────────────────────────────────

export interface ChannelPref {
  inapp: boolean;
  email: boolean;
  line: boolean;
  discord: boolean;
}

export interface NotificationPreferences {
  document_pending: ChannelPref;
  document_approved: ChannelPref;
  document_rejected: ChannelPref;
  document_recalled: ChannelPref;
  meeting_invited: ChannelPref;
  meeting_today: ChannelPref;
  meeting_minutes_ready: ChannelPref;
  regulation_review_assigned: ChannelPref;
  regulation_publish_ready: ChannelPref;
  regulation_published: ChannelPref;
  petition_assigned: ChannelPref;
  petition_replied: ChannelPref;
  petition_status_updated: ChannelPref;
  meal_class_collecting: ChannelPref;
  meal_pickup_ready: ChannelPref;
  shop_order_paid: ChannelPref;
  survey_invitation: ChannelPref;
  announcement: ChannelPref;
  calendar_event_invited: ChannelPref;
  calendar_event_updated: ChannelPref;
  work_item_assigned: ChannelPref;
  work_item_due: ChannelPref;
  system: ChannelPref;
}

export interface SearchResultOut {
  id: string;
  kind: "document" | "regulation" | "meeting" | "announcement" | string;
  title: string;
  summary: string;
  href: string;
}

export interface WebPushConfigOut {
  enabled: boolean;
  public_key: string;
}

export interface WebPushSubscriptionOut {
  id: string;
  endpoint: string;
  device_label: string | null;
  is_active: boolean;
}

// ── 系統防護 ───────────────────────────────────────────────────────────────

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

export interface LineBindingOut {
  linked: boolean;
  line_display_name: string | null;
  linked_at: string | null;
}

export interface LineLinkCodeOut {
  code: string;
  expires_at: string;
  instructions: string;
}

export interface DiscordBindingOut {
  linked: boolean;
  discord_user_id: string | null;
  username: string | null;
  global_name: string | null;
  linked_at: string | null;
}

export type DiscordRoleMappingKind = "org" | "position";

export interface DiscordGuildConfigOut {
  id: string;
  guild_id: string;
  name: string | null;
  office_channel_id: string | null;
  security_alert_channel_id: string | null;
  petition_entry_channel_id: string | null;
  petition_private_category_id: string | null;
  petition_staff_role_id: string | null;
  petition_private_channel_enabled: boolean;
  announcement_channel_id: string | null;
  moderation_log_channel_id: string | null;
  welcome_channel_id: string | null;
  admin_role_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type DiscordGuildConfigIn = Omit<DiscordGuildConfigOut, "id" | "created_at" | "updated_at">;

export interface DiscordBotHealthOut {
  bot_configured: boolean;
  oauth_configured: boolean;
  bot_user_id: string | null;
  bot_username: string | null;
  configured_guild_count: number;
  has_active_links: boolean;
}

export interface DiscordSyncAllOut {
  queued: number;
}

export interface DiscordRoleMappingOut {
  id: string;
  guild_id: string;
  role_id: string;
  mapping_kind: DiscordRoleMappingKind;
  org_id: string | null;
  position_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type DiscordRoleMappingIn = Omit<DiscordRoleMappingOut, "id" | "created_at" | "updated_at">;

export interface DiscordNicknamePrefixRuleOut {
  id: string;
  guild_id: string;
  prefix: string;
  priority: number;
  mapping_kind: DiscordRoleMappingKind;
  org_id: string | null;
  position_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type DiscordNicknamePrefixRuleIn = Omit<
  DiscordNicknamePrefixRuleOut,
  "id" | "created_at" | "updated_at"
>;

export interface DiscordOrgChannelMappingOut {
  id: string;
  guild_id: string;
  org_id: string;
  channel_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type DiscordOrgChannelMappingIn = Omit<
  DiscordOrgChannelMappingOut,
  "id" | "created_at" | "updated_at"
>;

export interface DiscordGuildOptionOut {
  id: string;
  name: string;
  icon: string | null;
}

export interface DiscordChannelOptionOut {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
}

export interface DiscordRoleOptionOut {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
}

export type WorkItemStatus = "open" | "done" | "canceled";

export interface WorkItemOut {
  id: string;
  title: string;
  description: string | null;
  status: WorkItemStatus;
  assigned_to_id: string | null;
  created_by_id: string | null;
  source_type: string | null;
  source_id: string | null;
  due_at: string | null;
  reminder_sent_at: string | null;
  completed_at: string | null;
  discord_channel_id: string | null;
  discord_message_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type WorkItemCreate = Pick<
  WorkItemOut,
  "title" | "description" | "assigned_to_id" | "source_type" | "source_id" | "due_at"
>;

export type WorkItemUpdate = Partial<
  Pick<WorkItemOut, "title" | "description" | "assigned_to_id" | "due_at" | "status">
>;

// ── 事情治理中樞 ─────────────────────────────────────────────────────────────

export type MatterStatus = "draft" | "active" | "paused" | "completed" | "archived" | "canceled";
export type MatterPriority = "low" | "normal" | "high" | "urgent";
export type MatterVisibility = "private" | "org" | "internal" | "public";
export type MatterType =
  | "activity"
  | "policy"
  | "regulation"
  | "petition"
  | "meeting"
  | "administration"
  | "project"
  | "other";
export type GovernanceCaseStatus =
  | "draft"
  | "todo"
  | "in_progress"
  | "review"
  | "approved"
  | "done"
  | "archived"
  | "canceled";
export type DecisionStatus =
  | "pending"
  | "in_progress"
  | "partial"
  | "completed"
  | "overdue"
  | "canceled";
export type PlanningDocumentStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "revision_requested"
  | "approved"
  | "archived";
export type AutomationRuleStatus = "active" | "paused" | "archived";

export interface ProgramOut {
  id: string;
  matter_id: string;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  starts_at: string | null;
  due_at: string | null;
  status: GovernanceCaseStatus | string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GovernanceCaseOut {
  id: string;
  matter_id: string;
  program_id: string | null;
  title: string;
  case_type: string;
  description: string | null;
  owner_user_id: string | null;
  status: GovernanceCaseStatus | string;
  current_step: string | null;
  due_at: string | null;
  completed_at: string | null;
  meta: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EntityRelationOut {
  id: string;
  matter_id: string | null;
  case_id: string | null;
  source_type: string;
  source_id: string | null;
  target_type: string;
  target_id: string | null;
  relation: string;
  title: string;
  href: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntityRelationGraphOut {
  nodes: Array<{ type: string; id: string }>;
  edges: EntityRelationOut[];
}

export interface TimelineEventOut {
  id: string;
  matter_id: string | null;
  case_id: string | null;
  event_type: string;
  title: string;
  body: string | null;
  actor_id: string | null;
  actor_email: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface DecisionOut {
  id: string;
  matter_id: string;
  case_id: string | null;
  source_type: string | null;
  source_id: string | null;
  title: string;
  content: string;
  status: DecisionStatus | string;
  owner_user_id: string | null;
  due_at: string | null;
  completed_at: string | null;
  meta: Record<string, unknown>;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanningDocumentRevisionOut {
  id: string;
  document_id: string;
  version_number: number;
  version_label: string;
  content: string;
  change_reason: string | null;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanningDocumentOut {
  id: string;
  matter_id: string;
  case_id: string | null;
  title: string;
  summary: string | null;
  status: PlanningDocumentStatus | string;
  current_version: number;
  created_by_id: string | null;
  approved_at: string | null;
  meta: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  revisions: PlanningDocumentRevisionOut[];
}

export interface MatterRoleAssignmentOut {
  id: string;
  matter_id: string;
  parent_id: string | null;
  role_name: string;
  unit_name: string | null;
  user_id: string | null;
  start_at: string | null;
  end_at: string | null;
  note: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GovernanceWorkflowTemplateOut {
  id: string;
  name: string;
  template_type: string;
  description: string | null;
  version: number;
  steps: Array<Record<string, unknown>>;
  created_by_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AutomationRuleOut {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  conditions: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
  matter_id: string | null;
  status: AutomationRuleStatus | string;
  last_triggered_at: string | null;
  trigger_count: number;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export type AutomationRuleUpdate = Partial<
  Pick<AutomationRuleOut, "name" | "description" | "trigger_type" | "conditions" | "actions" | "matter_id" | "status">
>;

export type MatterSpawnKind = "task" | "announcement" | "survey" | "meeting";

/** 從事情主動建立並連動的artifact回傳。 */
export interface MatterSpawnResult {
  kind: MatterSpawnKind;
  id: string;
  title: string;
  href: string;
}

/** 反向查詢：某模組資源被哪些事情納入。 */
export interface MatterLinkRef {
  relation_id: string;
  matter_id: string;
  matter_title: string;
  matter_status: string;
  matter_progress: number;
  relation: string;
  case_id: string | null;
}

/** 自動化規則編輯器選項（後端 /governance/automation-meta）。 */
export interface AutomationMeta {
  trigger_types: Record<string, string>;
  action_types: Record<string, string>;
  entity_types: Record<string, string>;
}

export interface MatterListItem {
  id: string;
  title: string;
  matter_type: MatterType | string;
  description: string | null;
  org_id: string | null;
  owner_user_id: string | null;
  starts_at: string | null;
  due_at: string | null;
  priority: MatterPriority | string;
  visibility: MatterVisibility | string;
  status: MatterStatus | string;
  progress_percent: number;
  created_by_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  case_count: number;
  open_task_count: number;
  link_count: number;
}

export interface MatterOut extends Omit<MatterListItem, "case_count" | "open_task_count" | "link_count"> {
  meta: Record<string, unknown>;
  programs: ProgramOut[];
  cases: GovernanceCaseOut[];
  links: EntityRelationOut[];
  events: TimelineEventOut[];
  decisions: DecisionOut[];
  planning_documents: PlanningDocumentOut[];
  role_assignments: MatterRoleAssignmentOut[];
}

export interface GovernanceStatsOut {
  active_matters: number;
  overdue_matters: number;
  open_cases: number;
  open_tasks: number;
  my_tasks: number;
  pending_decisions: number;
  plans_in_review: number;
}

export interface GovernanceDashboardOut {
  stats: GovernanceStatsOut;
  matters: MatterListItem[];
}

export type MatterCreate = Pick<
  MatterOut,
  | "title"
  | "matter_type"
  | "description"
  | "org_id"
  | "owner_user_id"
  | "starts_at"
  | "due_at"
  | "priority"
  | "visibility"
  | "status"
  | "meta"
>;
export type MatterUpdate = Partial<MatterCreate> & { progress_percent?: number };
export type ProgramCreate = Pick<
  ProgramOut,
  "name" | "description" | "owner_user_id" | "starts_at" | "due_at" | "status" | "sort_order"
>;
export type ProgramUpdate = Partial<ProgramCreate>;
export type GovernanceCaseCreate = Pick<
  GovernanceCaseOut,
  | "program_id"
  | "title"
  | "case_type"
  | "description"
  | "owner_user_id"
  | "status"
  | "current_step"
  | "due_at"
  | "meta"
>;
export type GovernanceCaseUpdate = Partial<GovernanceCaseCreate>;
export type EntityRelationCreate = Pick<
  EntityRelationOut,
  | "case_id"
  | "source_type"
  | "source_id"
  | "target_type"
  | "target_id"
  | "relation"
  | "title"
  | "href"
  | "note"
  | "meta"
>;
export type TimelineEventCreate = Pick<
  TimelineEventOut,
  "case_id" | "event_type" | "title" | "body" | "payload"
>;
export type DecisionCreate = Pick<
  DecisionOut,
  | "case_id"
  | "source_type"
  | "source_id"
  | "title"
  | "content"
  | "status"
  | "owner_user_id"
  | "due_at"
  | "meta"
>;
export type DecisionUpdate = Partial<DecisionCreate>;
export type PlanningDocumentCreate = Pick<
  PlanningDocumentOut,
  "case_id" | "title" | "summary" | "status" | "meta"
> & {
  version_label: string;
  content: string;
  change_reason?: string | null;
};
export type PlanningDocumentUpdate = Partial<
  Pick<PlanningDocumentOut, "case_id" | "title" | "summary" | "status" | "meta">
>;
export type PlanningDocumentRevisionCreate = Pick<
  PlanningDocumentRevisionOut,
  "version_label" | "content" | "change_reason"
>;
export type MatterRoleAssignmentCreate = Pick<
  MatterRoleAssignmentOut,
  | "parent_id"
  | "role_name"
  | "unit_name"
  | "user_id"
  | "start_at"
  | "end_at"
  | "note"
  | "sort_order"
>;
export type MatterRoleAssignmentUpdate = Partial<MatterRoleAssignmentCreate> & {
  is_active?: boolean;
};
export type GovernanceWorkflowTemplateCreate = Pick<
  GovernanceWorkflowTemplateOut,
  "name" | "template_type" | "description" | "version" | "steps"
>;
export type AutomationRuleCreate = Pick<
  AutomationRuleOut,
  "name" | "description" | "trigger_type" | "conditions" | "actions" | "matter_id" | "status"
>;

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

export interface AnalyticsInsightsOut {
  items: AnalyticsInsightItem[];
  total: number;
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

export interface RecipientSelector {
  user_ids: string[];
  position_ids: string[];
  org_ids: string[];
  /** 手動輸入的外部完整 Email，不需是系統使用者 */
  external_emails: string[];
  /** 全部使用者（含校外/管理員帳號） */
  include_all: boolean;
  /** 全部校內使用者（email 屬校內網域） */
  include_school: boolean;
}

export interface EmailCardRow {
  label: string;
  value: string;
}

export interface EmailVariableDefinition {
  key: string;
  label: string;
  required: boolean;
  default_value: string;
}

export interface EmailRecipientVariableInput {
  user_id?: string | null;
  email?: string | null;
  name?: string | null;
  variables: Record<string, string>;
}

export type EmailButtonStyle = "primary" | "secondary" | "outline";

export interface EmailButton {
  label: string;
  url: string;
  style: EmailButtonStyle;
}

export type EmailBlockType = "text" | "image" | "divider";

export interface EmailBlock {
  type: EmailBlockType;
  md?: string;
  url?: string;
  alt?: string;
}

export interface EmailComposePayload {
  subject: string;
  heading: string;
  preview_text: string;
  body: string;
  accent_color: string;
  background_color: string;
  content_background_color: string;
  body_line_height: number;
  paragraph_spacing: number;
  footer_text: string;
  show_system_footer: boolean;
  banner_image_url: string;
  banner_image_alt: string;
  card_rows: EmailCardRow[];
  cta_label: string;
  cta_url: string;
  buttons: EmailButton[];
  blocks: EmailBlock[];
  recipients: RecipientSelector;
  variable_definitions?: EmailVariableDefinition[];
  default_variables?: Record<string, string>;
  recipient_variables?: EmailRecipientVariableInput[];
  preview_variables?: Record<string, string>;
  preview_recipient?: EmailRecipientVariableInput | null;
  org_id?: string | null;
  template_id?: string | null;
  recipient_list_id?: string | null;
  attachment_ids?: string[];
  track_opens?: boolean;
  track_clicks?: boolean;
  idempotency_key?: string | null;
}

export interface EmailMessageCreate extends EmailComposePayload {
  action: "draft" | "schedule" | "send";
  scheduled_at?: string | null;
}

export interface RecipientPreviewOut {
  recipient_count: number;
  sample_names: string[];
  truncated: boolean;
}

export interface EmailMessageOut {
  id: string;
  sender_id: string | null;
  sender_name: string | null;
  subject: string;
  template: string;
  recipient_count: number;
  status: EmailStatus;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  org_id: string | null;
  template_id: string | null;
  track_opens: boolean;
  track_clicks: boolean;
}

export interface EmailMessageDetailOut extends EmailMessageOut {
  heading: string;
  preview_text: string;
  accent_color: string;
  background_color: string;
  content_background_color: string;
  body_line_height: number;
  paragraph_spacing: number;
  footer_text: string;
  show_system_footer: boolean;
  body: string;
  banner_image_url: string;
  banner_image_alt: string;
  card_rows: EmailCardRow[];
  cta_label: string;
  cta_url: string;
  buttons: EmailButton[];
  blocks: EmailBlock[];
  recipient_spec: RecipientSelector;
  variable_definitions: EmailVariableDefinition[];
  default_variables: Record<string, string>;
  recipient_variables: EmailRecipientVariableInput[];
  resolved_emails: string[];
  recipient_status_counts: Record<string, number>;
  recent_errors: string[];
  error_detail: string | null;
  attachment_ids: string[];
}

export interface EmailCampaignRecipientOut {
  id: string;
  message_id: string;
  user_id: string | null;
  email: string;
  name: string | null;
  variables: Record<string, string>;
  status: "queued" | "sent" | "failed" | "retrying" | "dead";
  celery_task_id: string | null;
  provider_id: string | null;
  sent_at: string | null;
  error_detail: string | null;
  attempt_count: number;
  next_retry_at: string | null;
  delivered_at: string | null;
  first_opened_at: string | null;
  last_opened_at: string | null;
  first_clicked_at: string | null;
  last_clicked_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  created_at: string;
  updated_at: string;
}

export type EmailResourceVisibility = "private" | "org";

export interface EmailTemplateOut {
  id: string;
  owner_id: string;
  org_id: string | null;
  visibility: EmailResourceVisibility;
  name: string;
  description: string;
  content: Partial<EmailComposePayload>;
  variable_definitions: EmailVariableDefinition[];
  is_favorite: boolean;
  is_active: boolean;
  current_version: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailRecipientListMemberOut {
  id: string;
  user_id: string | null;
  email: string;
  name: string | null;
  variables: Record<string, string>;
}

export interface EmailRecipientListOut {
  id: string;
  owner_id: string;
  org_id: string | null;
  visibility: EmailResourceVisibility;
  name: string;
  description: string;
  recipient_spec: Partial<RecipientSelector>;
  variable_definitions: EmailVariableDefinition[];
  is_active: boolean;
  members: EmailRecipientListMemberOut[];
  created_at: string;
  updated_at: string;
}

export interface EmailAttachmentOut {
  id: string;
  message_id: string | null;
  template_id: string | null;
  filename: string;
  content_type: string;
  file_size: number;
  delivery_mode: "attachment" | "link";
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface EmailPreflightOut {
  valid: boolean;
  resolved_count: number;
  unique_count: number;
  duplicate_emails: string[];
  invalid_emails: string[];
  suppressed_emails: string[];
  missing_names: string[];
  missing_variables: string[];
  attachment_total_bytes: number;
  attachment_warnings: string[];
  quota_remaining: number | null;
  estimated_batches: number;
}

export interface EmailAnalyticsOut {
  message_id: string;
  recipients: number;
  delivered: number;
  bounced: number;
  complained: number;
  opened: number;
  clicked: number;
  delivery_rate: number;
  bounce_rate: number;
  open_rate_estimated: number;
  click_rate: number;
  unopened_emails: string[];
  top_links: { url: string; clicks: number }[];
}

/** 職位精簡資訊（收件人選擇器用） */
export interface EmailPosition {
  id: string;
  name: string;
}

// ── 段考題庫 ────────────────────────────────────────────────────────────────

export type ExamGradeTrack = "first" | "second" | "third";

export interface ExamPaperListItem {
  id: string;
  title: string;
  subject: string;
  academic_year: number;
  semester: number;
  grade: number;
  grade_track: ExamGradeTrack | null;
  exam_number: number;
  filename: string;
  file_size: number;
  is_published: boolean;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

export interface ExamPaperOut extends ExamPaperListItem {
  content_type: string;
  is_active: boolean;
}

export interface ExamPaperUpdate {
  title?: string;
  subject?: string;
  academic_year?: number;
  semester?: number;
  grade?: number;
  grade_track?: ExamGradeTrack | null;
  exam_number?: number;
  is_published?: boolean;
}

export interface ExamPaperDownloadOut {
  id: string;
  paper_id: string;
  user_id: string;
  trace_code: string;
  file_sha256: string | null;
  ip_address: string | null;
  user_agent: string | null;
  downloaded_at: string;
  user_display_name: string;
  user_email: string;
  user_student_id: string | null;
}

export interface ExamTraceInspectMatch {
  trace_code: string;
  download_id: string;
  paper_id: string;
  paper_title: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  user_student_id: string | null;
  downloaded_at: string;
  confidence: string;
}

export interface ExamTraceInspectOut {
  detected_trace_codes: string[];
  matches: ExamTraceInspectMatch[];
  unsupported_reason: string | null;
}

// ── 政策、同意與個資請求 ────────────────────────────────────────────────

export type PolicyKind =
  | "privacy"
  | "terms"
  | "accessibility"
  | "cookie"
  | "security";

export interface PolicyDocumentOut {
  id: string;
  kind: PolicyKind;
  version: string;
  title: string;
  content_md: string;
  summary_md: string | null;
  effective_at: string;
  is_active: boolean;
  requires_explicit_consent: boolean;
  published_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PolicyDocumentListItem {
  id: string;
  kind: PolicyKind;
  version: string;
  title: string;
  effective_at: string;
  is_active: boolean;
}

export interface PendingConsentItem {
  policy_document_id: string;
  kind: PolicyKind;
  version: string;
  title: string;
  summary_md: string | null;
  effective_at: string;
  requires_explicit_consent: boolean;
}

export interface PolicyConsentOut {
  id: string;
  user_id: string;
  policy_document_id: string;
  agreed_at: string;
  ip_address: string | null;
  user_agent: string | null;
  policy_kind: PolicyKind | null;
  policy_version: string | null;
  policy_title: string | null;
}

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

// ── 公開官網 / Linktree ──────────────────────────────────────────────────────

export interface UploadedImageOut {
  url: string;
  filename: string;
  content_type: string;
  file_size: number;
}

export interface PublicSiteSettingsOut {
  id: string;
  site_title: string;
  site_description: string | null;
  site_logo_url: string | null;
  site_logo_alt: string | null;
  hero_title: string;
  hero_subtitle: string | null;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  about_title: string;
  about_body_md: string;
  mission_md: string | null;
  history_md: string | null;
  cta_label: string;
  cta_href: string;
  public_database_label: string;
  public_database_description: string | null;
  theme_config: Record<string, unknown>;
  homepage_blocks: Record<string, unknown>;
  custom_css: string | null;
  seo_title: string | null;
  seo_description: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicSiteSettingsUpdate = Partial<
  Omit<PublicSiteSettingsOut, "id" | "created_at" | "updated_at">
>;

export interface PublicLinkCategoryOut {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type PublicLinkCategoryCreate = Omit<
  PublicLinkCategoryOut,
  "id" | "created_at" | "updated_at"
>;
export type PublicLinkCategoryUpdate = Partial<PublicLinkCategoryCreate>;

export interface PublicLinkOut {
  id: string;
  title: string;
  url: string;
  description: string | null;
  category_id: string | null;
  category: PublicLinkCategoryOut | null;
  icon_key: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type PublicLinkCreate = Omit<
  PublicLinkOut,
  "id" | "category" | "created_at" | "updated_at"
>;
export type PublicLinkUpdate = Partial<PublicLinkCreate>;

export interface PublicOfficerProfileOut {
  id: string;
  user_position_id: string;
  display_name_override: string | null;
  title_override: string | null;
  bio: string | null;
  public_email: string | null;
  external_links: Record<string, unknown>;
  sort_order: number;
  is_featured: boolean;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

export type PublicOfficerProfileCreate = Omit<
  PublicOfficerProfileOut,
  "id" | "created_at" | "updated_at"
>;
export type PublicOfficerProfileUpdate = Partial<PublicOfficerProfileCreate>;

export interface PublicOfficerOut {
  id: string;
  profile_id: string | null;
  user_position_id: string;
  user_id: string;
  display_name: string;
  title: string;
  org_name: string;
  position_name: string;
  avatar_url: string | null;
  public_email: string | null;
  bio: string | null;
  external_links: Record<string, unknown>;
  start_date: string;
  end_date: string | null;
  sort_order: number;
  is_featured: boolean;
}

export interface PublicOfficerCandidateOut {
  user_position_id: string;
  user_id: string;
  display_name: string;
  email: string;
  show_email: boolean;
  avatar_url: string | null;
  org_id: string;
  org_name: string;
  position_id: string;
  position_name: string;
  start_date: string;
  end_date: string | null;
  has_public_profile: boolean;
}

export interface PublicSitePageOut {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  body_md: string;
  page_kind: string;
  layout_config: Record<string, unknown>;
  content_blocks: Record<string, unknown>;
  cover_image_url: string | null;
  cover_image_alt: string | null;
  seo_title: string | null;
  seo_description: string | null;
  nav_label: string | null;
  nav_order: number;
  sort_order: number;
  show_in_nav: boolean;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export type PublicSitePageCreate = Omit<PublicSitePageOut, "id" | "created_at" | "updated_at">;
export type PublicSitePageUpdate = Partial<PublicSitePageCreate>;

export interface PublicSiteBundleOut {
  settings: PublicSiteSettingsOut;
  links: PublicLinkOut[];
  link_categories: PublicLinkCategoryOut[];
  featured_officers: PublicOfficerOut[];
  nav_pages: PublicSitePageOut[];
}
