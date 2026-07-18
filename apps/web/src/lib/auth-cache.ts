import type { UserSummary } from "./types";

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
