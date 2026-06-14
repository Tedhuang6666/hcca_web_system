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

export function cacheCurrentUser(me: CurrentUserCache): void {
  localStorage.setItem("user_id", me.id);
  localStorage.setItem("user_email", me.email ?? "");
  localStorage.setItem("user_name", me.display_name ?? "");
  localStorage.setItem("user_avatar", me.avatar_url ?? "");
  localStorage.setItem("is_superuser", String(me.is_superuser ?? false));
  localStorage.setItem("is_owner", String(me.is_owner ?? false));
  localStorage.setItem("permissions", JSON.stringify(me.permissions ?? []));
  localStorage.setItem("is_external", String(me.allow_external_login ?? false));
}

export function clearAuthCache(): void {
  localStorage.removeItem("user_id");
  localStorage.removeItem("user_email");
  localStorage.removeItem("user_name");
  localStorage.removeItem("user_avatar");
  localStorage.removeItem("is_superuser");
  localStorage.removeItem("is_owner");
  localStorage.removeItem("permissions");
  localStorage.removeItem("is_external");
}

export type CachedUserSummary = Pick<UserSummary, "id" | "email" | "display_name">;

