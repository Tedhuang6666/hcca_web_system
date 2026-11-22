import { request } from "./core";

// ── 公文受文者 ─────────────────────────────────────────────────────────────────

export const documentsRecipientsApi = {
  update: (id: string, recipients: import("../types").RecipientCreatePayload[]) =>
    request<void>(`/documents/${id}/recipients`, {
      method: "PUT",
      body: JSON.stringify(recipients),
    }),
};
