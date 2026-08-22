import { describe, expect, it, vi } from "vitest";

import {
  cacheCurrentUser,
  clearAuthCache,
  clearImpersonationSession,
  getAuthItem,
  getImpersonationSession,
  getSecureAuthItem,
  saveImpersonationSession,
} from "./auth-cache";

describe("auth cache", () => {
  it("stores identification data in localStorage and sensitive data in sessionStorage", () => {
    cacheCurrentUser({
      id: "user-1",
      email: "user@example.com",
      display_name: "測試使用者",
      is_superuser: true,
      permissions: ["document:create"],
    });

    // 識別資料存 localStorage
    expect(localStorage.getItem("user_id")).toBe("user-1");
    // 敏感權限欄位改存 sessionStorage（SECURITY 升級）
    expect(sessionStorage.getItem("is_superuser")).toBe("true");
    expect(JSON.parse(sessionStorage.getItem("permissions") ?? "[]")).toEqual([
      "document:create",
    ]);
    // localStorage 不應再有敏感欄位（migration 清除）
    expect(localStorage.getItem("is_superuser")).toBeNull();
    expect(localStorage.getItem("permissions")).toBeNull();
  });

  it("removes all authentication keys from both localStorage and sessionStorage", () => {
    cacheCurrentUser({ id: "user-1", is_owner: true });

    clearAuthCache();

    expect(localStorage.getItem("user_id")).toBeNull();
    expect(sessionStorage.getItem("is_owner")).toBeNull();
    expect(sessionStorage.getItem("permissions")).toBeNull();
  });

  it("only exposes a non-sensitive SSR flag while impersonating", () => {
    saveImpersonationSession({
      token: "secret-token-must-not-appear-in-cookie",
      target_user_id: "target-1",
      target_email: "target@example.com",
      target_display_name: "目標使用者",
      actor_email: "admin@example.com",
      actor_display_name: "管理員",
      expires_at: Date.now() + 60_000,
    });

    expect(document.cookie).toContain("hcca_impersonating=1");
    expect(document.cookie).not.toContain("secret-token-must-not-appear-in-cookie");

    clearImpersonationSession();
    expect(document.cookie).not.toContain("hcca_impersonating=1");
  });

  it("reads valid impersonation sessions and clears expired sessions", () => {
    const session = {
      token: "temporary-token",
      target_user_id: "target-1",
      target_email: "target@example.com",
      target_display_name: "目標使用者",
      actor_email: "admin@example.com",
      actor_display_name: "管理員",
      expires_at: Date.now() + 60_000,
    };
    saveImpersonationSession(session);

    expect(getImpersonationSession()).toEqual(session);

    saveImpersonationSession({ ...session, expires_at: Date.now() - 1 });
    expect(getImpersonationSession()).toBeNull();
    expect(sessionStorage.getItem("hcca_impersonation")).toBeNull();
  });

  it("clears malformed impersonation data and exposes both cache stores", () => {
    sessionStorage.setItem("hcca_impersonation", "{broken");
    expect(getImpersonationSession()).toBeNull();

    cacheCurrentUser({ id: "user-2", permissions: ["document:create"] });
    expect(getAuthItem("user_id")).toBe("user-2");
    expect(getSecureAuthItem("permissions")).toBe('["document:create"]');
  });

  it("notifies an available service worker when auth cache changes", async () => {
    const postMessage = vi.fn();
    const previousServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: Promise.resolve({ active: { postMessage } }) },
    });

    try {
      cacheCurrentUser({ id: "user-3" });
      clearAuthCache();
      await Promise.resolve();
      await Promise.resolve();

      expect(postMessage).toHaveBeenCalledWith({ type: "SET_CACHE_USER", userId: "user-3" });
      expect(postMessage).toHaveBeenCalledWith({ type: "CLEAR_PRIVATE_CACHES" });
    } finally {
      if (previousServiceWorker) {
        Object.defineProperty(navigator, "serviceWorker", previousServiceWorker);
      } else {
        const navigatorWithOptionalServiceWorker = navigator as unknown as {
          serviceWorker?: unknown;
        };
        delete navigatorWithOptionalServiceWorker.serviceWorker;
      }
    }
  });
});
