import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { financeApi } from "./finance";

// Exercise the retained Excel transport, including download lifetime and session recovery.
describe("budget Excel download", () => {
  const createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(
    () => "blob:budget-workbook",
  );
  const revokeObjectURL = vi.fn();
  let downloads: { filename: string; href: string; attached: boolean }[];

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    downloads = [];
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ filename: this.download, href: this.href, attached: this.isConnected });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("downloads the workbook with credentials and releases its temporary URL", async () => {
    const contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      headers: { "Content-Type": contentType },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await financeApi.exportBudget("budget-123");

    expect(fetchMock).toHaveBeenCalledWith("/api/finance/budgets/budget-123/export.xlsx", expect.objectContaining({
      method: "GET", credentials: "include",
    }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0]?.[0]).toMatchObject({ size: 3, type: contentType });
    expect(downloads).toEqual([{ filename: "預算總表.xlsx", href: "blob:budget-workbook", attached: true }]);
    expect(document.querySelector('a[download="預算總表.xlsx"]')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:budget-workbook");
  });

  it("refreshes an expired session before retrying the same workbook", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("workbook"));
    vi.stubGlobal("fetch", fetchMock);

    await financeApi.exportBudget("budget-123");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/finance/budgets/budget-123/export.xlsx",
      "/api/auth/refresh",
      "/api/finance/budgets/budget-123/export.xlsx",
    ]);
    expect(downloads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
  });

  it("surfaces a forbidden response without creating a download", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "無權匯出此預算" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    })));

    await expect(financeApi.exportBudget("other-budget")).rejects.toMatchObject({
      status: 403, message: "無權匯出此預算",
    });
    expect(downloads).toEqual([]);
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
