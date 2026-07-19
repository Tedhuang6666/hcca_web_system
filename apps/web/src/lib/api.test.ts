import { describe, expect, it, vi } from "vitest";

import { ApiError, withFallback } from "./api-helpers";
import { governanceApi } from "./api/governance";

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
});
