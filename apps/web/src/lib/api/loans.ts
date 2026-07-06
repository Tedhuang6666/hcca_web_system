import type {
  LoanAvailableItem, LoanCheckoutCreate, LoanDashboard, LoanItemCreate, LoanItemOut, LoanItemUpdate, LoanRecordOut, LoanRecordStatus, LoanRecordUpdate, LoanUnitOut, LoanUnitUpdate,
} from "../types";
import { get, post, patch, del } from "./core";

// ── 物品借用系統 ───────────────────────────────────────────────────────────────

export const loansApi = {
  listItems: () => get<LoanItemOut[]>("/loans/items"),
  createItem: (body: LoanItemCreate) => post<LoanItemOut>("/loans/items", body),
  updateItem: (id: string, body: LoanItemUpdate) =>
    patch<LoanItemOut>(`/loans/items/${id}`, body),
  deleteItem: (id: string) => del<void>(`/loans/items/${id}`),

  listUnits: (itemId: string) => get<LoanUnitOut[]>(`/loans/items/${itemId}/units`),
  addUnits: (itemId: string, unitCodes: string[]) =>
    post<LoanUnitOut[]>(`/loans/items/${itemId}/units`, { unit_codes: unitCodes }),
  updateUnit: (id: string, body: LoanUnitUpdate) =>
    patch<LoanUnitOut>(`/loans/units/${id}`, body),

  availableItems: () => get<LoanAvailableItem[]>("/loans/items/available"),

  checkout: (body: LoanCheckoutCreate) =>
    post<LoanRecordOut>("/loans/checkout", body),
  returnItem: (id: string) =>
    post<LoanRecordOut>(`/loans/records/${id}/return`, {}),

  listRecords: (params?: {
    status?: LoanRecordStatus;
    item_id?: string;
    keyword?: string;
    limit?: number;
  }) => {
    const qs = params
      ? "?" +
        new URLSearchParams(
          Object.fromEntries(
            Object.entries(params)
              .filter(([, v]) => v != null)
              .map(([k, v]) => [k, String(v)]),
          ),
        ).toString()
      : "";
    return get<LoanRecordOut[]>(`/loans/records${qs}`);
  },
  updateRecord: (id: string, body: LoanRecordUpdate) =>
    patch<LoanRecordOut>(`/loans/records/${id}`, body),

  dashboard: () => get<LoanDashboard>("/loans/dashboard"),
};
