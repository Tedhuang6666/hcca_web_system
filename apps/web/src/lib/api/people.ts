import type {
  PersonAffiliationCreate, PersonAffiliationOut, PersonAffiliationUpdate, PersonCreate, PersonDetailOut, PersonListItem, PersonOut, PersonRosterImportResult, PersonUpdate,
} from "../types";
import { get, post, patch, del } from "./core";

// ── 人員與身分總表 ────────────────────────────────────────────────────────────

export const peopleApi = {
  list: (params?: {
    keyword?: string;
    class_id?: string;
    org_id?: string;
    position_id?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = params ? `?${new URLSearchParams(
      Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
        if (value !== undefined && value !== null && value !== "") acc[key] = String(value);
        return acc;
      }, {}),
    ).toString()}` : "";
    return get<PersonListItem[]>(`/people${qs}`);
  },
  create: (body: PersonCreate) => post<PersonOut>("/people", body),
  get: (id: string) => get<PersonDetailOut>(`/people/${id}`),
  update: (id: string, body: PersonUpdate) => patch<PersonOut>(`/people/${id}`, body),
  importRoster: (rows: Array<{
    student_id: string;
    display_name: string;
    email?: string | null;
    class_id?: string | null;
    academic_year?: number | null;
    note?: string | null;
  }>) => post<PersonRosterImportResult>("/people/import-roster", { rows }),
  createAffiliation: (body: PersonAffiliationCreate) =>
    post<PersonAffiliationOut>("/people/affiliations", body),
  updateAffiliation: (id: string, body: PersonAffiliationUpdate) =>
    patch<PersonAffiliationOut>(`/people/affiliations/${id}`, body),
  endAffiliation: (id: string) => del<PersonAffiliationOut>(`/people/affiliations/${id}`),
  syncPending: (id: string) => post<{ synced: number }>(`/people/${id}/sync-pending`, {}),
};
