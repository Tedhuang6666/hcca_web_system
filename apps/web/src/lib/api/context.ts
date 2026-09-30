import type {
  DocumentApprovalContextOut, PetitionResolutionContextOut, RegulationUsageContextOut,
} from "../types";
import { get } from "./core";

export const contextApi = {
  documentApproval: (id: string) =>
    get<DocumentApprovalContextOut>(`/documents/${id}/approval-context`),
  petitionResolution: (id: string) =>
    get<PetitionResolutionContextOut>(`/petitions/${id}/resolution-context`),
  regulationUsage: (id: string) =>
    get<RegulationUsageContextOut>(`/regulations/${id}/usage-context`),
};
