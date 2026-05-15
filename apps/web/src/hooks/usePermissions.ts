"use client";
import { useCallback, useMemo } from "react";

/**
 * 讀取 localStorage 中儲存的使用者權限列表（由 /auth/me 在登入時寫入）。
 * 超級管理員（is_superuser=true）視為擁有所有權限。
 *
 * 用法：
 *   const { can, isAdmin } = usePermissions();
 *   if (can("document:create")) { ... }
 */
export function usePermissions() {
  const { permissions, isAdmin, isOwner } = useMemo(() => {
    if (typeof window === "undefined") return { permissions: new Set<string>(), isAdmin: false, isOwner: false };
    const raw = localStorage.getItem("permissions");
    const superuser = localStorage.getItem("is_superuser") === "true";
    const owner = localStorage.getItem("is_owner") === "true";
    let perms: string[] = [];
    try { perms = raw ? JSON.parse(raw) : []; } catch { /* ignore */ }
    // Owner 視為超管：自動擁有所有權限
    return { permissions: new Set<string>(perms), isAdmin: superuser || owner, isOwner: owner };
  }, []);

  /** 是否擁有指定權限（超管自動通過） */
  const can = useCallback((code: string) =>
    isAdmin
    || permissions.has("admin:all")
    || permissions.has(code)
    || (code === "audit:view_org" && (permissions.has("audit:view_all") || permissions.has("audit:view"))),
    [isAdmin, permissions],
  );

  /** 是否擁有任一指定權限（超管自動通過） */
  const canAny = useCallback((...codes: string[]) =>
    isAdmin
    || permissions.has("admin:all")
    || codes.some(c =>
      permissions.has(c)
      || (c === "audit:view_org" && (permissions.has("audit:view_all") || permissions.has("audit:view")))
    ),
    [isAdmin, permissions],
  );

  return { can, canAny, isAdmin, isOwner, permissions };
}
