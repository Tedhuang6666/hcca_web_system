import { get, patch, post } from "./core";
import type {
  ElectronicCredentialAuthorizationBulkCreate,
  ElectronicCredentialAuthorizationBulkOut,
  ElectronicCredentialAuthorizationCreate,
  ElectronicCredentialAuthorizationOut,
  ElectronicCredentialAuthorizationUpdate,
  ElectronicCredentialOut,
  ElectronicCredentialSettingsOut,
  ElectronicCredentialSettingsUpdate,
} from "@/lib/types";

export const electronicCredentialsApi = {
  me: () => get<ElectronicCredentialOut>("/electronic-credentials/me"),
  adminGetSettings: () =>
    get<ElectronicCredentialSettingsOut>("/electronic-credentials/admin/settings"),
  adminUpdateSettings: (body: ElectronicCredentialSettingsUpdate) =>
    patch<ElectronicCredentialSettingsOut>("/electronic-credentials/admin/settings", body),
  adminListAuthorizations: (includeInactive = true) =>
    get<ElectronicCredentialAuthorizationOut[]>(
      `/electronic-credentials/admin/authorizations?include_inactive=${includeInactive}`,
    ),
  adminCreateAuthorization: (body: ElectronicCredentialAuthorizationCreate) =>
    post<ElectronicCredentialAuthorizationOut>(
      "/electronic-credentials/admin/authorizations",
      body,
    ),
  adminBulkCreateAuthorizations: (body: ElectronicCredentialAuthorizationBulkCreate) =>
    post<ElectronicCredentialAuthorizationBulkOut>(
      "/electronic-credentials/admin/authorizations/bulk",
      body,
    ),
  adminUpdateAuthorization: (id: string, body: ElectronicCredentialAuthorizationUpdate) =>
    patch<ElectronicCredentialAuthorizationOut>(
      `/electronic-credentials/admin/authorizations/${id}`,
      body,
    ),
};
