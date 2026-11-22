import { get } from "./core";

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
