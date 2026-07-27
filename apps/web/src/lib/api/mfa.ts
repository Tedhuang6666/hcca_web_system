import type {
  MFAChallengeOut, MFASetupOut, MFAStatusOut, PasskeyAuthenticationOptionsOut, PasskeyOut,
  PasskeyRegistrationOptionsOut,
} from "../types";
import { get, post, request } from "./core";

export const mfaApi = {
  status: () => get<MFAStatusOut>("/auth/mfa/status"),
  setup: () => post<MFASetupOut>("/auth/mfa/setup", {}),
  confirm: (code: string) => post<{ message: string }>("/auth/mfa/confirm", { code }),
  verify: (code: string) => post<{ verified: boolean }>("/auth/mfa/verify", { code }),
  exchangeChallenge: () => get<MFAChallengeOut>("/auth/mfa/exchange-challenge"),
  verifyLogin: (challenge_token: string, code: string) =>
    post<{ message: string }>("/auth/mfa/login/verify", { challenge_token, code }),
  regenerateBackupCodes: (code: string) =>
    post<{ backup_codes: string[] }>("/auth/mfa/backup-codes/regenerate", { code }),
  disable: (code: string) =>
    request<{ message: string }>("/auth/mfa/disable", {
      method: "DELETE",
      body: JSON.stringify({ code }),
    }),
  passkeys: () => get<PasskeyOut[]>("/auth/mfa/passkeys"),
  registrationOptions: () =>
    post<PasskeyRegistrationOptionsOut>("/auth/mfa/passkeys/registration/options", {}),
  verifyRegistration: (
    transaction_id: string,
    credential: unknown,
    device_name?: string,
  ) => post<PasskeyOut>("/auth/mfa/passkeys/registration/verify", {
    transaction_id,
    credential,
    device_name,
  }),
  deletePasskey: (credential_id: string, code?: string) =>
    request<{ message: string }>(`/auth/mfa/passkeys/${encodeURIComponent(credential_id)}`, {
      method: "DELETE",
      body: JSON.stringify(code ? { code } : {}),
    }),
  authenticationOptions: (challenge_token?: string) =>
    post<PasskeyAuthenticationOptionsOut>("/auth/mfa/passkeys/authentication/options", {
      challenge_token,
    }),
  verifyAuthentication: (
    transaction_id: string,
    credential: unknown,
  ) => post<{ message?: string; verified?: boolean }>("/auth/mfa/passkeys/authentication/verify", {
    transaction_id,
    credential,
  }),
};
