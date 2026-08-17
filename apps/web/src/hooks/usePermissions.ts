"use client";
import { useCallback, useSyncExternalStore } from "react";
import { AUTH_CACHE_EVENT } from "@/lib/auth-cache";

type PermissionState = {
  permissions: Set<string>;
  isAdmin: boolean;
  isOwner: boolean;
};

const EMPTY_PERMISSION_STATE: PermissionState = {
  permissions: new Set<string>(),
  isAdmin: false,
  isOwner: false,
};

// Keep one stable snapshot for useSyncExternalStore. It gives React the same
// server snapshot during hydration, then switches to the browser cache after
// the hydrated tree is subscribed, preventing permission-driven text changes
// from interrupting streaming hydration.
let clientPermissionState = EMPTY_PERMISSION_STATE;

function equalPermissionState(left: PermissionState, right: PermissionState): boolean {
  if (
    left.isAdmin !== right.isAdmin
    || left.isOwner !== right.isOwner
    || left.permissions.size !== right.permissions.size
  ) return false;
  for (const permission of left.permissions) {
    if (!right.permissions.has(permission)) return false;
  }
  return true;
}

function refreshClientPermissionState(onChange: () => void) {
  const next = readPermissionState();
  if (equalPermissionState(clientPermissionState, next)) return;
  clientPermissionState = next;
  onChange();
}

function subscribeToPermissionState(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const refresh = () => refreshClientPermissionState(onChange);
  window.addEventListener(AUTH_CACHE_EVENT, refresh);
  // useSyncExternalStore invokes this after hydration, so browser-only
  // sessionStorage is never read into the server-rendered tree.
  refresh();
  return () => window.removeEventListener(AUTH_CACHE_EVENT, refresh);
}

function getClientPermissionState() {
  return clientPermissionState;
}

function getServerPermissionState() {
  return EMPTY_PERMISSION_STATE;
}

function readPermissionState(): PermissionState {
  if (typeof window === "undefined") {
    return { permissions: new Set<string>(), isAdmin: false, isOwner: false };
  }
  const raw = sessionStorage.getItem("permissions");
  const superuser = sessionStorage.getItem("is_superuser") === "true";
  const owner = sessionStorage.getItem("is_owner") === "true";
  let perms: string[] = [];
  try { perms = raw ? JSON.parse(raw) : []; } catch { /* ignore */ }
  return { permissions: new Set<string>(perms), isAdmin: superuser || owner, isOwner: owner };
}

/**
 * 讀取使用者權限列表（由 /auth/me 在登入時寫入 sessionStorage）。
 * 超級管理員（is_superuser=true）視為擁有所有權限。
 *
 * 用法：
 *   const { can, isAdmin } = usePermissions();
 *   if (can("document:create")) { ... }
 */
export function usePermissions() {
  const permissionState = useSyncExternalStore(
    subscribeToPermissionState,
    getClientPermissionState,
    getServerPermissionState,
  );
  const { permissions, isAdmin, isOwner } = permissionState;

  /** 是否擁有指定權限（超管自動通過） */
  const can = useCallback((code: string) =>
    isAdmin
    || permissions.has("admin:all")
    || permissions.has(code)
    || (code === "document:draft" && permissions.has("document:create"))
    || (code === "audit:view_org" && (permissions.has("audit:view_all") || permissions.has("audit:view"))),
    [isAdmin, permissions],
  );

  /** 是否擁有任一指定權限（超管自動通過） */
  const canAny = useCallback((...codes: string[]) =>
    isAdmin
    || permissions.has("admin:all")
    || codes.some(c =>
      permissions.has(c)
      || (c === "document:draft" && permissions.has("document:create"))
      || (c === "audit:view_org" && (permissions.has("audit:view_all") || permissions.has("audit:view")))
    ),
    [isAdmin, permissions],
  );

  return { can, canAny, isAdmin, isOwner, permissions };
}
