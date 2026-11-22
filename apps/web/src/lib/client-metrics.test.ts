import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function metrics() {
  return import("./client-metrics");
}

describe("client metric delivery", () => {
  it("finishes the keepalive response stream after a successful batch", async () => {
    const response = new Response('{"status":"accepted","accepted":1}', { status: 202 });
    const read = vi.spyOn(response, "arrayBuffer");
    const fetcher = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetcher);
    const { recordClientMetric, flushClientMetrics } = await metrics();
    recordClientMetric({ metric: "page_view", value: 1 });
    flushClientMetrics();
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(response.bodyUsed).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("client-metrics/batch"),
      expect.objectContaining({ method: "POST", keepalive: true, credentials: "include" }));
  });

  it("drains an error response and backs off before allowing a later batch", async () => {
    const response = new Response("unavailable", { status: 503 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response)
      .mockResolvedValue(new Response("{}", { status: 202 })));
    const { recordClientMetric, flushClientMetrics } = await metrics();
    recordClientMetric({ metric: "page_view", value: 1 });
    flushClientMetrics();
    await vi.waitFor(() => expect(response.bodyUsed).toBe(true));
    recordClientMetric({ metric: "lcp", value: 1000 });
    flushClientMetrics();
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    recordClientMetric({ metric: "lcp", value: 1100 });
    flushClientMetrics();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("contains stream failures and preserves beacon delivery on page exit", async () => {
    const response = new Response("{}");
    vi.spyOn(response, "arrayBuffer").mockRejectedValue(new Error("stream interrupted"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const { recordClientMetric, flushClientMetrics } = await metrics();
    recordClientMetric({ metric: "page_view", value: 1 });
    flushClientMetrics();
    await vi.advanceTimersByTimeAsync(0);
    recordClientMetric({ metric: "lcp", value: 1000 });
    flushClientMetrics();
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    const beacon = vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);
    recordClientMetric({ metric: "lcp", value: 1100 });
    flushClientMetrics(true);
    expect(beacon).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
