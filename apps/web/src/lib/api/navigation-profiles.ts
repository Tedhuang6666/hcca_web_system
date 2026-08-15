import type {
  NavigationProfileCreate, NavigationProfileOut, NavigationProfileResolveOut, NavigationProfileUpdate,
} from "../types";
import { get, post, patch, del } from "./core";

let currentProfilePromise: Promise<NavigationProfileResolveOut> | null = null;

function resolveMyProfile(): Promise<NavigationProfileResolveOut> {
  // Sidebar 與 BottomTabBar 會在同一個 mount 同時解析導覽設定；共用 in-flight
  // promise，避免每次載入產生兩個相同的私有 API 請求。
  if (currentProfilePromise) return currentProfilePromise;
  currentProfilePromise = get<NavigationProfileResolveOut>("/admin/navigation-profiles/me")
    .finally(() => {
      currentProfilePromise = null;
    });
  return currentProfilePromise;
}

export const navigationProfilesApi = {
  public: (key: "public" | "student") =>
    get<NavigationProfileOut>(`/navigation-profiles/${key}`),
  list: (includeInactive = true) =>
    get<NavigationProfileOut[]>(
      `/admin/navigation-profiles?include_inactive=${String(includeInactive)}`,
    ),
  me: resolveMyProfile,
  create: (body: NavigationProfileCreate) =>
    post<NavigationProfileOut>("/admin/navigation-profiles", body),
  update: (id: string, body: NavigationProfileUpdate) =>
    patch<NavigationProfileOut>(`/admin/navigation-profiles/${id}`, body),
  delete: (id: string) => del<void>(`/admin/navigation-profiles/${id}`),
};
