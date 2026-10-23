import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("refresh response cleanup", () => {
  it.each([[200, "ok"], [401, "invalid"], [503, "unavailable"]] as const)(
    "preserves status %i as %s while reading its acknowledgement",
    async (status, expected) => {
      const response = new Response("{}", { status });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      const { refreshWithStatus } = await import("./refresh");
      expect(await refreshWithStatus()).toBe(expected);
      expect(response.bodyUsed).toBe(true);
    },
  );

  it("keeps a successful refresh valid if the unused acknowledgement stream fails", async () => {
    const response = new Response("{}", { status: 200 });
    vi.spyOn(response, "arrayBuffer").mockRejectedValue(new Error("stream closed"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const { refreshWithStatus } = await import("./refresh");
    expect(await refreshWithStatus()).toBe("ok");
  });

  it("coalesces simultaneous refresh requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    const { refreshWithStatus } = await import("./refresh");
    expect(await Promise.all([refreshWithStatus(), refreshWithStatus()])).toEqual(["ok", "ok"]);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
