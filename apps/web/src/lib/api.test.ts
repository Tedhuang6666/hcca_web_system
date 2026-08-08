import { describe, expect, it, vi } from "vitest";

import { ApiError, withFallback } from "./api-helpers";
import { governanceApi } from "./api/governance";
import { request } from "./api/core";
import {
  clearImpersonationSession,
  saveImpersonationSession,
} from "./auth-cache";

describe("API helpers", () => {
  it("returns successful values without invoking the error hook", async () => {
    const onError = vi.fn();

    await expect(withFallback(Promise.resolve("ok"), "fallback", onError)).resolves.toBe(
      "ok",
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns a fallback and reports the original error", async () => {
    const error = new Error("offline");
    const onError = vi.fn();

    await expect(withFallback(Promise.reject(error), [], onError)).resolves.toEqual([]);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("keeps request correlation fields on API errors", () => {
    const error = new ApiError(503, "服務暫時不可用", "request-1", "error-1");

    expect(error.status).toBe(503);
    expect(error.requestId).toBe("request-1");
    expect(error.errorId).toBe("error-1");
  });

  it("does not double-encode an already encoded governance matter slug", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "matter-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await governanceApi.getMatterBySlug("%E6%B8%AC%E8%A9%A6");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/governance/matters/by-slug/%E6%B8%AC%E8%A9%A6",
      expect.objectContaining({ credentials: "include" }),
    );
    vi.unstubAllGlobals();
  });

  it("adds the impersonation token to API requests", async () => {
    saveImpersonationSession({
      token: "impersonation-token",
      target_user_id: "target-1",
      target_email: "target@example.com",
      target_display_name: "目標使用者",
      actor_email: "admin@example.com",
      actor_display_name: "管理員",
      expires_at: Date.now() + 60_000,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await request("/auth/me");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer impersonation-token" }),
      }),
    );
    clearImpersonationSession();
    vi.unstubAllGlobals();
  });

  it("does not report an already-counted circuit-open state as another client error", async () => {
    const fetchMock = vi.fn().mockImplementation(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: "backend unavailable" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(request("/test/circuit-open")).rejects.toMatchObject({ status: 503 });
    }
    await expect(request("/test/circuit-open")).rejects.toMatchObject({ status: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it("treats a 401 after refresh as an expired session", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "expired" }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/auth-me-retry")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
