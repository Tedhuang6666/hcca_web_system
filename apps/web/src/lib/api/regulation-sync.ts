import type { RegulationSyncSourceUpdate, RegulationSyncStatusOut } from "../types";
import { get, post, put, pathSegment } from "./core";

const sourcePath = (orgId: string) => `/regulations/sync/${pathSegment(orgId)}`;

export const regulationSyncApi = {
  status: (orgId: string) => get<RegulationSyncStatusOut>(sourcePath(orgId)),
  configure: (orgId: string, body: RegulationSyncSourceUpdate) =>
    put<RegulationSyncStatusOut>(sourcePath(orgId), body),
  run: (orgId: string) => post<RegulationSyncStatusOut>(`${sourcePath(orgId)}/run`, {}),
};
