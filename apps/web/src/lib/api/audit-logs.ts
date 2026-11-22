import type {
  AuditLogOut,
} from "../types";
import { BASE, get } from "./core";

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
