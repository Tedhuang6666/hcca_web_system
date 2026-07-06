import { get, post, patch } from "./core";

// ── Feature Flags（後台）─────────────────────────────────────────────────
export interface FeatureFlagOut {
  id: string;
  key: string;
  description: string | null;
  is_globally_enabled: boolean;
  percentage_rollout: number;
  enabled_user_ids: string[];
  enabled_permission_codes: string[];
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeatureFlagCreate {
  key: string;
  description?: string | null;
}

export interface FeatureFlagUpdate {
  description?: string | null;
  is_globally_enabled?: boolean;
  percentage_rollout?: number;
  enabled_user_ids?: string[];
  enabled_permission_codes?: string[];
}

export const featureFlagsApi = {
  list: () => get<FeatureFlagOut[]>("/feature-flags"),
  create: (body: FeatureFlagCreate) => post<FeatureFlagOut>("/feature-flags", body),
  update: (id: string, body: FeatureFlagUpdate) =>
    patch<FeatureFlagOut>(`/feature-flags/${encodeURIComponent(id)}`, body),
  archive: (id: string) =>
    post<FeatureFlagOut>(`/feature-flags/${encodeURIComponent(id)}/archive`, {}),
};
