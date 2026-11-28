import type {
  AgencyEntryCreate, AgencyEntryOut, AgencyEntryUpdate, AgencyManageOut, AgencyProfileAdminUpdate,
  AgencyProfileCreate, AgencyProfileOut, AgencyProfileUpdate,
} from "../types";
import { get, post, patch, del } from "./core";

// ── 自治機關專頁維護 ─────────────────────────────────────────────────────────

const manage = (id: string) => `/agencies/manage/${encodeURIComponent(id)}`;

export const agenciesApi = {
  manageable: () => get<AgencyManageOut[]>("/agencies/manage"),
  create: (body: AgencyProfileCreate) => post<AgencyProfileOut>("/agencies/manage", body),
  update: (id: string, body: AgencyProfileUpdate) => patch<AgencyProfileOut>(manage(id), body),
  adminUpdate: (id: string, body: AgencyProfileAdminUpdate) =>
    patch<AgencyProfileOut>(`${manage(id)}/admin`, body),
  remove: (id: string) => del<void>(manage(id)),
  entries: (id: string) => get<AgencyEntryOut[]>(`${manage(id)}/entries`),
  createEntry: (id: string, body: AgencyEntryCreate) =>
    post<AgencyEntryOut>(`${manage(id)}/entries`, body),
  updateEntry: (id: string, entryId: string, body: AgencyEntryUpdate) =>
    patch<AgencyEntryOut>(`${manage(id)}/entries/${encodeURIComponent(entryId)}`, body),
  deleteEntry: (id: string, entryId: string) =>
    del<void>(`${manage(id)}/entries/${encodeURIComponent(entryId)}`),
};
