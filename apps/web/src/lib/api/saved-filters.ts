import type {
  SavedFilterOut,
} from "../types";
import { get, post, patch, del } from "./core";

// ── 常用篩選（Saved Filters）───────────────────────────────────────────────────

export const savedFiltersApi = {
  list: (scope?: string) => {
    const qs = scope ? `?scope=${encodeURIComponent(scope)}` : "";
    return get<SavedFilterOut[]>(`/saved-filters${qs}`);
  },
  create: (body: { scope: string; name: string; description?: string; params: Record<string, unknown>; share_path?: string }) =>
    post<SavedFilterOut>("/saved-filters", body),
  update: (id: string, body: Partial<{ name: string; description: string; params: Record<string, unknown>; share_path: string }>) =>
    patch<SavedFilterOut>(`/saved-filters/${id}`, body),
  delete: (id: string) => del<void>(`/saved-filters/${id}`),
};
