import type {
  NavigationProfileCreate, NavigationProfileOut, NavigationProfileResolveOut, NavigationProfileUpdate,
} from "../types";
import { get, post, patch, del } from "./core";

export const navigationProfilesApi = {
  list: (includeInactive = true) =>
    get<NavigationProfileOut[]>(
      `/admin/navigation-profiles?include_inactive=${String(includeInactive)}`,
    ),
  me: () => get<NavigationProfileResolveOut>("/admin/navigation-profiles/me"),
  create: (body: NavigationProfileCreate) =>
    post<NavigationProfileOut>("/admin/navigation-profiles", body),
  update: (id: string, body: NavigationProfileUpdate) =>
    patch<NavigationProfileOut>(`/admin/navigation-profiles/${id}`, body),
  delete: (id: string) => del<void>(`/admin/navigation-profiles/${id}`),
};
