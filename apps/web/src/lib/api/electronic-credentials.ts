import { get, patch, post } from "./core";
import type {
  ElectronicCredentialAuthorizationCreate,
  ElectronicCredentialAuthorizationOut,
  ElectronicCredentialAuthorizationUpdate,
  ElectronicCredentialOut,
} from "@/lib/types";

export const electronicCredentialsApi = {
  me: () => get<ElectronicCredentialOut>("/electronic-credentials/me"),
  adminListAuthorizations: (includeInactive = true) =>
    get<ElectronicCredentialAuthorizationOut[]>(
      `/electronic-credentials/admin/authorizations?include_inactive=${includeInactive}`,
    ),
  adminCreateAuthorization: (body: ElectronicCredentialAuthorizationCreate) =>
    post<ElectronicCredentialAuthorizationOut>(
      "/electronic-credentials/admin/authorizations",
      body,
    ),
  adminUpdateAuthorization: (id: string, body: ElectronicCredentialAuthorizationUpdate) =>
    patch<ElectronicCredentialAuthorizationOut>(
      `/electronic-credentials/admin/authorizations/${id}`,
      body,
    ),
};
