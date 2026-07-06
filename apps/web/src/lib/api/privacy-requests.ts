import { get, post, patch } from "./core";
import type { PrivacyRequestType, PrivacyRequestStatus, PrivacyRequestOut } from "./core";

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
