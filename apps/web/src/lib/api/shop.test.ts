import { afterEach, describe, expect, it, vi } from "vitest";

import { shopApi } from "./shop";

describe("shop quantity API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("omits unset dates from the quantities request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await shopApi.orderQuantities({ date_from: undefined, date_to: undefined });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost");
    expect(requestUrl.searchParams.has("date_from")).toBe(false);
    expect(requestUrl.searchParams.has("date_to")).toBe(false);
  });

  it("keeps selected dates and false-valued filters in the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await shopApi.orderQuantities({
      date_from: "2026-10-01T00:00:00.000Z",
      date_to: "2026-10-10T15:59:59.000Z",
      is_paid: "false",
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost");
    expect(requestUrl.searchParams.get("date_from")).toBe("2026-10-01T00:00:00.000Z");
    expect(requestUrl.searchParams.get("date_to")).toBe("2026-10-10T15:59:59.000Z");
    expect(requestUrl.searchParams.get("is_paid")).toBe("false");
  });
});

describe("class order API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not reuse cached class orders or summaries", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await shopApi.listClassOrders();
    await shopApi.classSummary();

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ cache: "no-store" }));
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ cache: "no-store" }));
  });
});
