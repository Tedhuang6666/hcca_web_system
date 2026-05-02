import type {
  DocumentOut, DocumentListItem, DocumentCreate,
  ProductOut, OrderOut, OrderListItem, OrderCreate,
  RegulationOut, RegulationListItem,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── 核心 fetch 包裝 ────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const get = <T>(p: string) => request<T>(p);
const post = <T>(p: string, body?: unknown) => request<T>(p, { method: "POST", body: JSON.stringify(body) });
const patch = <T>(p: string, body: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(body) });
const del = <T>(p: string) => request<T>(p, { method: "DELETE" });

// ── 公文 ──────────────────────────────────────────────────────────────────────

export const documentsApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<DocumentListItem[]>(`/documents${qs}`);
  },
  get: (id: string) => get<DocumentOut>(`/documents/${id}`),
  create: (body: DocumentCreate) => post<DocumentOut>("/documents", body),
  update: (id: string, body: Partial<DocumentCreate> & { change_note?: string }) =>
    patch<DocumentOut>(`/documents/${id}`, body),
  delete: (id: string) => del<void>(`/documents/${id}`),
  submit: (id: string, approver_ids: string[]) =>
    post<DocumentOut>(`/documents/${id}/submit`, { approver_ids }),
  approve: (id: string, comment?: string) =>
    post<DocumentOut>(`/documents/${id}/approve`, { comment }),
  reject: (id: string, comment: string, mode: "to_creator" | "to_previous" = "to_creator") =>
    post<DocumentOut>(`/documents/${id}/reject`, { comment, mode }),
  recall: (id: string) => post<DocumentOut>(`/documents/${id}/recall`),
  archive: (id: string) => post<DocumentOut>(`/documents/${id}/archive`),
  uploadAttachment: (id: string, file: File) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    const fd = new FormData(); fd.append("file", file);
    return request<{ id: string; filename: string; url: string }>(`/documents/${id}/attachments`, {
      method: "POST",
      body: fd,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
  deleteAttachment: (id: string, attachmentId: string) =>
    del<void>(`/documents/${id}/attachments/${attachmentId}`),
};

// ── 商店 ──────────────────────────────────────────────────────────────────────

export const shopApi = {
  listProducts: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<ProductOut[]>(`/shop/products${qs}`);
  },
  getProduct: (id: string) => get<ProductOut>(`/shop/products/${id}`),
  createOrder: (body: OrderCreate) => post<OrderOut>("/shop/orders", body),
  listOrders: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<OrderListItem[]>(`/shop/orders${qs}`);
  },
  getOrder: (id: string) => get<OrderOut>(`/shop/orders/${id}`),
  cancelOrder: (id: string, reason?: string) =>
    post<OrderOut>(`/shop/orders/${id}/cancel`, { reason }),
  downloadReport: (format: "xlsx" | "csv") => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    return fetch(`${BASE}/shop/reports/orders.${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
};

// ── 法規 ──────────────────────────────────────────────────────────────────────

export const regulationsApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<RegulationListItem[]>(`/regulations${qs}`);
  },
  get: (id: string) => get<RegulationOut>(`/regulations/${id}`),
  create: (body: { title: string; category: string; content: string; org_id: string }) =>
    post<RegulationOut>("/regulations", body),
  update: (id: string, body: Partial<{ title: string; category: string; content: string }>) =>
    patch<RegulationOut>(`/regulations/${id}`, body),
  publish: (id: string) => post<RegulationOut>(`/regulations/${id}/publish`),
  archive: (id: string) => post<RegulationOut>(`/regulations/${id}/archive`),
  delete: (id: string) => del<void>(`/regulations/${id}`),
};

// ── 使用者 / Auth ──────────────────────────────────────────────────────────────

export const authApi = {
  me: () => get<{ id: string; display_name: string; email: string; permissions: string[] }>("/auth/me"),
  listUsers: () => get<{ id: string; display_name: string; email: string }[]>("/users"),
};
