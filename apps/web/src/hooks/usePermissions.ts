"use client";
import { useCallback, useEffect, useState } from "react";
import { AUTH_CACHE_EVENT } from "@/lib/auth-cache";

type PermissionState = {
  permissions: Set<string>;
  isAdmin: boolean;
  isOwner: boolean;
};

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
  const [permissionState, setPermissionState] = useState<PermissionState>(readPermissionState);
  const { permissions, isAdmin, isOwner } = permissionState;

  useEffect(() => {
    const refresh = () => setPermissionState(readPermissionState());
    refresh();
    window.addEventListener(AUTH_CACHE_EVENT, refresh);
    return () => window.removeEventListener(AUTH_CACHE_EVENT, refresh);
  }, []);

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
