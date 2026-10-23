import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("./core", () => ({ BASE: "/api", get: vi.fn(), post: api.post }));

beforeEach(() => {
  vi.resetModules();
  api.post.mockReset();
  document.cookie = "csrf_token=; Max-Age=0; path=/";
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "csrf_token=; Max-Age=0; path=/";
});

describe("page view CSRF initialization", () => {
  it("finishes the initialization response before recording a page view", async () => {
    const response = new Response('{"status":"ready"}');
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      document.cookie = "csrf_token=local-test; path=/";
      return response;
    }));
    const { analyticsApi } = await import("./analytics");
    await analyticsApi.trackPageView("/dashboard");
    expect(response.bodyUsed).toBe(true);
    expect(api.post).toHaveBeenCalledWith("/analytics/page-views", { path: "/dashboard" });
  });

  it("keeps the CSRF requirement when initialization does not set a cookie", async () => {
    const response = new Response("{}");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const { analyticsApi } = await import("./analytics");
    await analyticsApi.trackPageView("/dashboard");
    expect(response.bodyUsed).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
});
