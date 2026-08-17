import type {
  NavigationProfileCreate, NavigationProfileOut, NavigationProfileResolveOut, NavigationProfileUpdate,
} from "../types";
import { get, post, patch, del } from "./core";

let currentProfilePromise: Promise<NavigationProfileResolveOut> | null = null;
const PROFILE_CACHE_KEY = "hcca:navigation-profile:resolved";
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

function clearProfileCache() {
  if (typeof window !== "undefined") sessionStorage.removeItem(PROFILE_CACHE_KEY);
}

function readProfileCache(): NavigationProfileResolveOut | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return undefined;
    const cached = JSON.parse(raw) as { savedAt: number; value: NavigationProfileResolveOut };
    if (!Number.isFinite(cached.savedAt) || Date.now() - cached.savedAt > PROFILE_CACHE_TTL_MS) {
      clearProfileCache();
      return undefined;
    }
    return cached.value;
  } catch {
    return undefined;
  }
}

function resolveMyProfile(): Promise<NavigationProfileResolveOut> {
  // Sidebar 與 BottomTabBar 會在同一個 mount 同時解析導覽設定；共用 in-flight
  // promise，避免每次載入產生兩個相同的私有 API 請求。
  if (currentProfilePromise) return currentProfilePromise;
  const cached = readProfileCache();
  if (cached) return Promise.resolve(cached);
  currentProfilePromise = get<NavigationProfileResolveOut>("/admin/navigation-profiles/me")
    .then((value) => {
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), value }));
        } catch {
          /* storage may be unavailable */
        }
      }
      return value;
    })
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
    post<NavigationProfileOut>("/admin/navigation-profiles", body).finally(clearProfileCache),
  update: (id: string, body: NavigationProfileUpdate) =>
    patch<NavigationProfileOut>(`/admin/navigation-profiles/${id}`, body).finally(clearProfileCache),
  delete: (id: string) => del<void>(`/admin/navigation-profiles/${id}`).finally(clearProfileCache),
};
