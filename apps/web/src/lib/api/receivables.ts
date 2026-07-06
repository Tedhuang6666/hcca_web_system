import type {
  ReceivableOut, ReceivableSource, ReceivableSummaryOut,
} from "../types";
import { BASE, get, post, patch } from "./core";

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
