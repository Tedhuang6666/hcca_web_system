import type { UserSummary } from "./types";
import { cachePurge } from "./api-cache";

export interface CurrentUserCache {
  id: string;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  is_superuser?: boolean;
  is_owner?: boolean;
  permissions?: string[];
  allow_external_login?: boolean;
}

export const AUTH_CACHE_EVENT = "hcca:auth-cache-updated";
export const IMPERSONATION_EVENT = "hcca:impersonation-updated";
const IMPERSONATION_STORAGE_KEY = "hcca_impersonation";
const IMPERSONATION_RENDER_FLAG_COOKIE = "hcca_impersonating";

export interface ImpersonationSession {
  token: string;
  target_user_id: string;
  target_email: string;
  target_display_name: string;
  actor_email: string;
  actor_display_name: string;
  expires_at: number;
  read_only?: boolean;
}

// SECURITY: 敏感權限資料（is_superuser、is_owner、permissions）改存 sessionStorage，
// 在瀏覽器關閉後自動清除，減少 XSS 或本機存取攻擊的曝露窗口。
// 識別資料（user_id、email、name、avatar）仍存 localStorage 以維持跨 tab 一致性。
// 注意：sessionStorage 仍可被同 tab XSS 存取，不可作為授權依據（授權由 API 負責）。

function ls(): Storage | null {
  return typeof window !== "undefined" ? window.localStorage : null;
}
function ss(): Storage | null {
  return typeof window !== "undefined" ? window.sessionStorage : null;
}

function notifyAuthCacheUpdated(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CACHE_EVENT));
}

function notifyImpersonationUpdated(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(IMPERSONATION_EVENT));
}

/**
 * 此 cookie 只標示 SSR 不可安全預載個人資料；不包含 token、身分或權限資料。
 */
function setImpersonationRenderFlag(expiresAt?: number): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  if (!expiresAt || expiresAt <= Date.now()) {
    document.cookie = `${IMPERSONATION_RENDER_FLAG_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    return;
  }
  const maxAge = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1_000));
  document.cookie = `${IMPERSONATION_RENDER_FLAG_COOKIE}=1; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

function clearServiceWorkerPrivateCaches(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready.then((registration) => {
    registration.active?.postMessage({ type: "CLEAR_PRIVATE_CACHES" });
  }).catch(() => {
    // Service Worker registration is optional; auth cache cleanup must still finish.
  });
}

function setServiceWorkerCacheUser(userId: string): void {
  if (typeof navigator === "undefined" || !userId || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready.then((registration) => {
    registration.active?.postMessage({ type: "SET_CACHE_USER", userId });
  }).catch(() => {
    // Service Worker is optional; auth state remains authoritative.
  });
}

export function saveImpersonationSession(session: ImpersonationSession): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify(session));
  setImpersonationRenderFlag(session.expires_at);
  notifyImpersonationUpdated();
}

export function getImpersonationSession(): ImpersonationSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as ImpersonationSession;
    if (!session.token || session.expires_at <= Date.now()) {
      clearImpersonationSession();
      return null;
    }
    return session;
  } catch {
    clearImpersonationSession();
    return null;
  }
}

export function clearImpersonationSession(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
  setImpersonationRenderFlag();
  notifyImpersonationUpdated();
}

export function cacheCurrentUser(me: CurrentUserCache): void {
  ls()?.setItem("user_id", me.id);
  ls()?.setItem("user_email", me.email ?? "");
  ls()?.setItem("user_name", me.display_name ?? "");
  ls()?.setItem("user_avatar", me.avatar_url ?? "");
  ls()?.setItem("is_external", String(me.allow_external_login ?? false));

  // 敏感欄位存 sessionStorage（tab 關閉即清除）
  ss()?.setItem("is_superuser", String(me.is_superuser ?? false));
  ss()?.setItem("is_owner", String(me.is_owner ?? false));
  ss()?.setItem("permissions", JSON.stringify(me.permissions ?? []));

  // 清除舊版遺留在 localStorage 的敏感欄位（migration）
  ls()?.removeItem("is_superuser");
  ls()?.removeItem("is_owner");
  ls()?.removeItem("permissions");
  setServiceWorkerCacheUser(me.id);
  notifyAuthCacheUpdated();
}

export function clearAuthCache(): void {
  ls()?.removeItem("user_id");
  ls()?.removeItem("user_email");
  ls()?.removeItem("user_name");
  ls()?.removeItem("user_avatar");
  ls()?.removeItem("is_external");
  // legacy cleanup
  ls()?.removeItem("is_superuser");
  ls()?.removeItem("is_owner");
  ls()?.removeItem("permissions");

  ss()?.removeItem("is_superuser");
  ss()?.removeItem("is_owner");
  ss()?.removeItem("permissions");
  clearImpersonationSession();
  cachePurge();
  clearServiceWorkerPrivateCaches();
  notifyAuthCacheUpdated();
}

/**
 * 讀取識別用 auth cache 項目（只讀 localStorage）。
 * 敏感欄位（is_superuser / is_owner / permissions）請直接讀 sessionStorage，
 * 避免攻擊者在未登入時向 localStorage 注入偽造值。
 */
export function getAuthItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

/** 讀取敏感欄位（只讀 sessionStorage，不 fallback localStorage）。 */
export function getSecureAuthItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(key);
}

export type CachedUserSummary = Pick<UserSummary, "id" | "email" | "display_name">;
