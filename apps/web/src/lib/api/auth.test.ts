import { describe, expect, it, vi } from "vitest";

import { authApi } from "./auth";
import { cacheCurrentUser } from "../auth-cache";

describe("auth API", () => {
  it("shares an in-flight /auth/me request and reuses the short-lived result", async () => {
    cacheCurrentUser({ id: "user-auth-cache" });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: "user-auth-cache",
        display_name: "測試使用者",
        email: "user@example.com",
        permissions: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([authApi.me(), authApi.me()]);
    await authApi.me();

    expect(first.id).toBe("user-auth-cache");
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("can refresh /auth/me even when a cached user exists", async () => {
    cacheCurrentUser({ id: "user-auth-cache" });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: "user-auth-cache",
        display_name: "更新後使用者",
        email: "user@example.com",
        permissions: ["org:manage"],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const refreshed = await authApi.refresh();

    expect(refreshed.display_name).toBe("更新後使用者");
    expect(refreshed.permissions).toEqual(["org:manage"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
