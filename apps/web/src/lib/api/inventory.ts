import type {
  InventoryCategoryCreate, InventoryCategoryOut, InventoryCategoryUpdate, InventoryDashboard, InventoryItemAdjust, InventoryItemCreate, InventoryItemOut, InventoryItemType, InventoryItemUpdate, InventoryProcurementCreate, InventoryProcurementOut, InventoryProcurementStatus, InventoryProcurementUpdate, InventoryTransactionOut, InventoryTxnType,
} from "../types";
import { get, post, patch, del } from "./core";

// ── 物資管理系統 ───────────────────────────────────────────────────────────────

function buildQs(params: Record<string, string | boolean | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== "");
  if (!entries.length) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

export const inventoryApi = {
  // 類別
  listCategories: () => get<InventoryCategoryOut[]>("/inventory/categories"),
  createCategory: (body: InventoryCategoryCreate) =>
    post<InventoryCategoryOut>("/inventory/categories", body),
  updateCategory: (id: string, body: InventoryCategoryUpdate) =>
    patch<InventoryCategoryOut>(`/inventory/categories/${id}`, body),
  deleteCategory: (id: string) => del<void>(`/inventory/categories/${id}`),

  // 品項
  listItems: (params?: {
    category_id?: string;
    item_type?: InventoryItemType;
    low_stock_only?: boolean;
    keyword?: string;
    include_inactive?: boolean;
  }) => get<InventoryItemOut[]>(`/inventory/items${buildQs(params ?? {})}`),
  createItem: (body: InventoryItemCreate) =>
    post<InventoryItemOut>("/inventory/items", body),
  getItem: (id: string) => get<InventoryItemOut>(`/inventory/items/${id}`),
  updateItem: (id: string, body: InventoryItemUpdate) =>
    patch<InventoryItemOut>(`/inventory/items/${id}`, body),
  deleteItem: (id: string) => del<void>(`/inventory/items/${id}`),
  adjustStock: (id: string, body: InventoryItemAdjust) =>
    post<InventoryTransactionOut>(`/inventory/items/${id}/adjust`, body),
  listItemTransactions: (id: string, limit?: number) =>
    get<InventoryTransactionOut[]>(`/inventory/items/${id}/transactions${limit ? `?limit=${limit}` : ""}`),

  // 異動日誌
  listTransactions: (params?: {
    item_id?: string;
    txn_type?: InventoryTxnType;
    limit?: number;
  }) => get<InventoryTransactionOut[]>(`/inventory/transactions${buildQs({
    item_id: params?.item_id,
    txn_type: params?.txn_type,
    limit: params?.limit === undefined ? undefined : String(params.limit),
  })}`),

  // 採購申請
  listProcurements: (params?: {
    status?: InventoryProcurementStatus;
    own_only?: boolean;
  }) => get<InventoryProcurementOut[]>(`/inventory/procurements${buildQs(params ?? {})}`),
  createProcurement: (body: InventoryProcurementCreate) =>
    post<InventoryProcurementOut>("/inventory/procurements", body),
  getProcurement: (id: string) =>
    get<InventoryProcurementOut>(`/inventory/procurements/${id}`),
  updateProcurement: (id: string, body: InventoryProcurementUpdate) =>
    patch<InventoryProcurementOut>(`/inventory/procurements/${id}`, body),
  submitProcurement: (id: string) =>
    post<InventoryProcurementOut>(`/inventory/procurements/${id}/submit`, {}),
  approveProcurement: (id: string) =>
    post<InventoryProcurementOut>(`/inventory/procurements/${id}/approve`, {}),
  rejectProcurement: (id: string, reviewer_notes?: string) =>
    post<InventoryProcurementOut>(
      `/inventory/procurements/${id}/reject${reviewer_notes ? `?reviewer_notes=${encodeURIComponent(reviewer_notes)}` : ""}`,
      {},
    ),
  receiveProcurement: (
    id: string,
    received_quantities: Record<string, number>,
    notes?: string,
  ) =>
    post<InventoryProcurementOut>(`/inventory/procurements/${id}/receive`, {
      received_quantities,
      notes,
    }),

  // 儀表板
  dashboard: () => get<InventoryDashboard>("/inventory/dashboard"),
};
