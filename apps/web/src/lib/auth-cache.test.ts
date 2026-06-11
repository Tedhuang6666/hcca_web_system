import { describe, expect, it } from "vitest";

import { cacheCurrentUser, clearAuthCache } from "./auth-cache";

describe("auth cache", () => {
  it("stores the current user and permissions", () => {
    cacheCurrentUser({
      id: "user-1",
      email: "user@example.com",
      display_name: "測試使用者",
      is_superuser: true,
      permissions: ["document:create"],
    });

    expect(localStorage.getItem("user_id")).toBe("user-1");
    expect(localStorage.getItem("is_superuser")).toBe("true");
    expect(JSON.parse(localStorage.getItem("permissions") ?? "[]")).toEqual([
      "document:create",
    ]);
  });

  it("removes all authentication keys", () => {
    cacheCurrentUser({ id: "user-1", is_owner: true });

    clearAuthCache();

    expect(localStorage.getItem("user_id")).toBeNull();
    expect(localStorage.getItem("is_owner")).toBeNull();
    expect(localStorage.getItem("permissions")).toBeNull();
  });
});
