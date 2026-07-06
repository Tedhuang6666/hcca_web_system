import { get, post } from "./core";

// ── API Keys ─────────────────────────────────────────────────────────────
export interface ApiKeyOut {
  id: string;
  name: string;
  key_prefix: string;
  owner_user_id: string;
  scopes: string[];
  rate_limit_per_minute: number;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ApiKeyCreate {
  name: string;
  scopes?: string[];
  rate_limit_per_minute?: number;
  expires_at?: string | null;
}

export interface ApiKeyCreatedResponse {
  api_key: ApiKeyOut;
  key_plaintext: string;
}

export const apiKeysApi = {
  list: (include_revoked = false) =>
    get<ApiKeyOut[]>(`/api-keys?include_revoked=${include_revoked}`),
  create: (body: ApiKeyCreate) => post<ApiKeyCreatedResponse>("/api-keys", body),
  detail: (id: string) => get<ApiKeyOut>(`/api-keys/${encodeURIComponent(id)}`),
  revoke: (id: string, reason: string) =>
    post<ApiKeyOut>(`/api-keys/${encodeURIComponent(id)}/revoke`, { reason }),
};
