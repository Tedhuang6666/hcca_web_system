import { describe, expect, it } from "vitest";

import { cacheCurrentUser, clearAuthCache } from "./auth-cache";

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
});
