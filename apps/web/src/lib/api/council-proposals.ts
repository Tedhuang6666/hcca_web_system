import type {
  CouncilProposalCaseType, CouncilProposalCreate, CouncilProposalListItem, CouncilProposalOut, CouncilProposalStatus,
} from "../types";
import { get, post, patch } from "./core";

// ── 議會提案 ───────────────────────────────────────────────────────────────

function councilProposalQuery(params?: {
  status?: CouncilProposalStatus;
  case_type?: CouncilProposalCaseType;
}): string {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.case_type) sp.set("case_type", params.case_type);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export const councilProposalsApi = {
  create: (body: CouncilProposalCreate) => post<CouncilProposalOut>("/council-proposals", body),
  my: (params?: { status?: CouncilProposalStatus; case_type?: CouncilProposalCaseType }) => {
    const qs = councilProposalQuery(params);
    return get<CouncilProposalListItem[]>(`/council-proposals/my${qs}`);
  },
  list: (params?: { status?: CouncilProposalStatus; case_type?: CouncilProposalCaseType }) => {
    const qs = councilProposalQuery(params);
    return get<CouncilProposalListItem[]>(`/council-proposals${qs}`);
  },
  get: (id: string) => get<CouncilProposalOut>(`/council-proposals/${id}`),
  updateStatus: (
    id: string,
    body: {
      status: CouncilProposalStatus;
      committee_review_note?: string | null;
    },
  ) => patch<CouncilProposalOut>(`/council-proposals/${id}/status`, body),
};
