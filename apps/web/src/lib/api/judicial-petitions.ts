import type {
  JudicialPetitionCreate, JudicialPetitionListItem, JudicialPetitionOut, JudicialPetitionStatus,
} from "../types";
import { get, post, patch } from "./core";

// ── 評議委員會訴訟 ───────────────────────────────────────────────────────

export const judicialPetitionsApi = {
  create: (body: JudicialPetitionCreate) => post<JudicialPetitionOut>("/judicial-petitions", body),
  my: (params?: { status?: JudicialPetitionStatus }) => {
    const qs = params?.status
      ? `?${new URLSearchParams({ status: params.status }).toString()}`
      : "";
    return get<JudicialPetitionListItem[]>(`/judicial-petitions/my${qs}`);
  },
  list: (params?: { status?: JudicialPetitionStatus }) => {
    const qs = params?.status
      ? `?${new URLSearchParams({ status: params.status }).toString()}`
      : "";
    return get<JudicialPetitionListItem[]>(`/judicial-petitions${qs}`);
  },
  get: (id: string) => get<JudicialPetitionOut>(`/judicial-petitions/${id}`),
  updateStatus: (
    id: string,
    body: {
      status: JudicialPetitionStatus;
      docketing_note?: string | null;
      decision_summary?: string | null;
    },
  ) => patch<JudicialPetitionOut>(`/judicial-petitions/${id}/status`, body),
};
