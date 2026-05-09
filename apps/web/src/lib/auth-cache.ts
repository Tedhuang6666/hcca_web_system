import type { UserSummary } from "./types";

export interface CurrentUserCache {
  id: string;
  email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  is_superuser?: boolean;
  permissions?: string[];
}

export function cacheCurrentUser(me: CurrentUserCache): void {
  localStorage.setItem("user_id", me.id);
  localStorage.setItem("user_email", me.email ?? "");
  localStorage.setItem("user_name", me.display_name ?? "");
  localStorage.setItem("user_avatar", me.avatar_url ?? "");
  localStorage.setItem("is_superuser", String(me.is_superuser ?? false));
  localStorage.setItem("permissions", JSON.stringify(me.permissions ?? []));
}

export function clearAuthCache(): void {
  localStorage.removeItem("user_id");
  localStorage.removeItem("user_email");
  localStorage.removeItem("user_name");
  localStorage.removeItem("user_avatar");
  localStorage.removeItem("is_superuser");
  localStorage.removeItem("permissions");
}

export type CachedUserSummary = Pick<UserSummary, "id" | "email" | "display_name">;

