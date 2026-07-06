import type {
  PendingConsentItem, PolicyConsentOut,
} from "../types";
import { get, post, patch } from "./core";
import type { PrivacyRequestStatus, PrivacyRequestOut } from "./core";

// ── 政策（隱私 / ToS / Cookie / 無障礙）───────────────────────────────
export type PolicyKind =
  | "privacy"
  | "terms"
  | "cookie"
  | "accessibility"
  | "security";

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
