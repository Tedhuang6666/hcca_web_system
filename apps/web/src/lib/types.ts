// ── 公文系統型別 ──────────────────────────────────────────────────────────────

export type DocumentStatus = "draft" | "pending" | "approved" | "rejected" | "archived";
export type DocumentUrgency = "normal" | "urgent" | "most_urgent" | "flash";
export type DocumentClassification = "normal" | "confidential" | "secret" | "top_secret";
export type DocumentCategory = "letter" | "decree";
export type RecipientType = "main" | "primary" | "copy";
export type ApprovalStepStatus = "pending" | "approved" | "rejected" | "waiting";
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
  content_type: string;
  file_size: number;
  url: string;
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
  approver: ApproverOut;
  delegate: ApproverOut | null;
}

export interface DocumentOut {
  id: string;
  serial_number: string;
  title: string;
  urgency: DocumentUrgency;
  classification: DocumentClassification;
  category: DocumentCategory;
  subject: string | null;
  doc_description: string | null;
  action_required: string | null;
  content: string;
  issuer_org_name: string | null;
  handler_name: string | null;
  handler_unit: string | null;
  handler_phone: string | null;
  handler_email: string | null;
  status: DocumentStatus;
  current_step: number;
  issued_at: string | null;
  due_date: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  org_id: string;
  created_by: string;
  revisions: RevisionOut[];
  approvals: ApprovalStepOut[];
  attachments: AttachmentOut[];
  recipients: RecipientOut[];
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
  urgency?: DocumentUrgency; classification?: DocumentClassification; category?: DocumentCategory;
  subject?: string; doc_description?: string; action_required?: string;
  content?: string; issuer_org_name?: string;
  handler_name?: string; handler_unit?: string; handler_phone?: string; handler_email?: string;
  due_date?: string;
  recipients?: { recipient_type: RecipientType; name: string; email?: string }[];
}

// ── 商店系統型別 ──────────────────────────────────────────────────────────────

export type ProductStatus = "draft" | "active" | "sold_out" | "archived";
export type OrderStatus = "pending" | "paid" | "cancelled" | "refunded";

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

export type RegulationCategory = "charter" | "bylaw" | "procedure" | "policy" | "other";

export interface RegulationOut {
  id: string; title: string; category: RegulationCategory;
  content: string; version: number; is_active: boolean;
  org_id: string; created_by: string;
  published_at: string | null; created_at: string; updated_at: string;
}

export interface RegulationListItem {
  id: string; title: string; category: RegulationCategory;
  version: number; is_active: boolean; org_id: string;
  published_at: string | null; created_at: string; updated_at: string;
}

// ── 通用型別 ──────────────────────────────────────────────────────────────────

export interface ApiError { detail: string; status: number }
export interface PaginatedResponse<T> { items: T[]; total: number; page: number; size: number }
