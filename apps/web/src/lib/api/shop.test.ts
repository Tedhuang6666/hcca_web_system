import { afterEach, describe, expect, it, vi } from "vitest";

import { shopApi } from "./shop";

describe("shop quantity API", () => {
  it("收款用目錄明確保留已結單活動，一般商品目錄沿用隱藏預設", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("[]", {
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await shopApi.catalog();
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("include_closed");
    await shopApi.catalog("activity-1", true);
    const url = new URL(String(fetchMock.mock.calls[1][0]), "http://localhost");
    expect(url.searchParams.get("include_closed")).toBe("true");
    expect(url.searchParams.get("activity_id")).toBe("activity-1");
    await shopApi.catalog(undefined, false, ["主題名稱", "商品名稱"]);
    const directUrl = new URL(String(fetchMock.mock.calls[2][0]), "http://localhost");
    expect(directUrl.searchParams.getAll("direct_path")).toEqual(["主題名稱", "商品名稱"]);
    expect(directUrl.searchParams.has("include_closed")).toBe(false);
  });

  it("downloads a class receipt for one activity and preserves server errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("%PDF-1.7", {
      headers: { "Content-Type": "application/pdf" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await shopApi.downloadClassReceipt("class-1", "activity-1")).status).toBe(200);
    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
    expect(url.pathname).toMatch(/\/shop\/orders\/classes\/class-1\/receipt.pdf$/);
    expect(url.searchParams.get("activity_id")).toBe("activity-1");
    await shopApi.downloadClassReceipt("class-1", null);
    expect(String(fetchMock.mock.calls[1][0])).not.toContain("activity_id");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: "此活動尚無有效訂單可產生收據" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    }));
    await expect(shopApi.downloadClassReceipt("class-1", null)).rejects.toThrow("此活動尚無有效訂單可產生收據");
  });

  it("downloads selected class receipts in one request or all classes for an activity", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("%PDF-1.7", {
      headers: { "Content-Type": "application/pdf" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await shopApi.downloadClassReceipts({ activity_id: "activity-1" }, ["class-1", "class-2"]);
    const selectedRequest = fetchMock.mock.calls[0];
    expect(String(selectedRequest[0])).toMatch(/\/shop\/orders\/classes\/receipts\.pdf$/);
    expect(selectedRequest[1].method).toBe("POST");
    expect(new Headers(selectedRequest[1].headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(selectedRequest[1].body)).toEqual({
      activity_id: "activity-1",
      class_ids: ["class-1", "class-2"],
      unpaid_only: false,
    });

    await shopApi.downloadClassReceipts({ activity_id: "activity-1" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      activity_id: "activity-1",
      class_ids: null,
      unpaid_only: false,
    });

    await shopApi.downloadClassReceipts({ activity_id: "activity-1" }, undefined, true);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      activity_id: "activity-1",
      class_ids: null,
      unpaid_only: true,
    });

    await shopApi.downloadChangedOrderReceipts({ activity_id: "activity-1" });
    expect(String(fetchMock.mock.calls[3][0])).toMatch(/\/shop\/orders\/receipts\/changed\.pdf$/);
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ activity_id: "activity-1" });

    await shopApi.downloadClassReceipts({ activity_id: null });
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({
      activity_id: null,
      class_ids: null,
      unpaid_only: false,
    });
  });

  it("supports exact topic scopes for receipt downloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("%PDF-1.7", {
      headers: { "Content-Type": "application/pdf" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await shopApi.downloadClassReceipts({ category_id: "category-1" }, undefined, true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      category_id: "category-1",
      class_ids: null,
      unpaid_only: true,
    });

    await shopApi.downloadChangedOrderReceipts({ category_id: "category-1" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ category_id: "category-1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends delegation secrets in the body and keeps them out of request URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await shopApi.accessDelegation("synthetic-test-token", true);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("synthetic-test-token");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: "synthetic-test-token", claim: true });
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

  it.each(["expired", "mfa"] as const)("keeps delegation secrets out of the %s redirect", async (kind) => {
    const replace = vi.fn();
    const location = { pathname: "/shop", search: "", hash: "#delegate=synthetic-test-token", replace };
    const browser = window;
    vi.stubGlobal("window", new Proxy(browser, { get(target, key) {
      if (key === "location") return location;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } }));
    browser.localStorage.setItem("user_id", "synthetic-parent");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("{}", {
      status: kind === "expired" ? 401 : 403,
      headers: { "Content-Type": "application/json", ...(kind === "mfa" ? { "X-MFA-Required": "true" } : {}) },
    })));
    await expect(shopApi.accessDelegation("synthetic-test-token")).rejects.toMatchObject({ status: kind === "expired" ? 401 : 403 });
    expect(replace).toHaveBeenCalledWith(kind === "expired"
      ? "/login?next=%2Fshop%3Fdelegation%3Dresume"
      : "/settings/security?mfa_required=1&next=%2Fshop%3Fdelegation%3Dresume");
    expect(browser.sessionStorage.getItem("hcca:shop:pending-delegation")).toBe("synthetic-test-token");
  });

  it.each(["expired", "mfa"] as const)("preserves ordinary navigation for the %s redirect", async (kind) => {
    const replace = vi.fn();
    const location = { pathname: "/shop/orders", search: "?from=class", hash: "#items", replace };
    const browser = window;
    vi.stubGlobal("window", new Proxy(browser, { get(target, key) {
      if (key === "location") return location;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } }));
    browser.localStorage.setItem("user_id", "synthetic-student");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("{}", {
      status: kind === "expired" ? 401 : 403,
      headers: { "Content-Type": "application/json", ...(kind === "mfa" ? { "X-MFA-Required": "true" } : {}) },
    })));
    await expect(shopApi.listOrders()).rejects.toMatchObject({ status: kind === "expired" ? 401 : 403 });
    expect(replace).toHaveBeenCalledWith(kind === "expired"
      ? "/login?next=%2Fshop%2Forders%3Ffrom%3Dclass%23items"
      : "/settings/security?mfa_required=1&next=%2Fshop%2Forders%3Ffrom%3Dclass");
    expect(browser.sessionStorage.getItem("hcca:shop:pending-delegation")).toBeNull();
  });
});
