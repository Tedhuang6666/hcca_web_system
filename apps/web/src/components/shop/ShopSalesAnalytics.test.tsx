import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShopSalesAnalytics from "./ShopSalesAnalytics";
import type {
  ShopSalesAnalyticsOut,
  ShopSalesMetrics,
  ShopSalesPeriod,
} from "@/lib/types";

const api = vi.hoisted(() => ({ salesAnalytics: vi.fn() }));
const ws = vi.hoisted(() => ({
  callback: (_message: { type: string }) => {
    void _message;
  },
  room: null as string | null,
}));
vi.mock("@/lib/api", () => ({
  shopApi: api,
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock("@/hooks/useWS", () => ({
  useWS: (room: string | null, callback: typeof ws.callback) => {
    ws.room = room;
    ws.callback = callback;
  },
}));

const metrics: ShopSalesMetrics = {
  order_count: 2,
  buyer_count: 1,
  item_count: 3,
  total_amount: 250,
  paid_amount: 200,
  unpaid_amount: 50,
  discount_amount: 50,
  discounted_order_count: 1,
  average_order_amount: 125,
  average_items_per_order: 1.5,
  promotion_usage_rate: 50,
  payment_rate: 80,
};
const row = {
  buyer_count: 1,
  key: "one",
  label: "一年級",
  order_count: 2,
  item_count: 3,
  total_amount: 250,
  paid_amount: 200,
};
function period(): ShopSalesPeriod {
  return {
    date_from: "2026-10-22",
    date_to: "2026-10-23",
    metrics: { ...metrics },
    daily: [
      {
        ...row,
        key: "2026-10-22",
        label: "2026-10-22",
        cumulative_amount: 250,
      },
      {
        ...row,
        key: "2026-10-23",
        label: "2026-10-23",
        order_count: 0,
        item_count: 0,
        total_amount: 0,
        paid_amount: 0,
        cumulative_amount: 250,
      },
    ],
    grades: [row],
    classes: [row],
    products: [{ ...row, label: "紀念衫" }],
    variants: [{ ...row, label: "紀念衫 · 尺寸：L" }],
    hours: [row],
    sources: [row],
    amount_bands: [row],
    item_bands: [row],
  };
}
function fixture(): ShopSalesAnalyticsOut {
  return {
    generated_at: "2026-10-23T02:00:00Z",
    timezone: "Asia/Taipei",
    current: period(),
    previous: period(),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  api.salesAnalytics.mockResolvedValue(fixture());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("銷售分析", () => {
  it("passes scoped filters, compares dates, and exposes exact daily and variant values", async () => {
    render(
      <ShopSalesAnalytics
        filters={{
          activity_id: "festival",
          product_id: "shirt",
          date_from: "2026-10-22",
          date_to: "2026-10-23",
          is_paid: "false",
        }}
        live
      />,
    );
    await screen.findByText("訂購金額", { selector: "dt" });
    expect(api.salesAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({
        activity_id: "festival",
        product_id: "shirt",
        is_paid: "false",
        compare: "true",
      }),
    );
    expect(ws.room).toBe("shop:orders");
    fireEvent.change(screen.getByLabelText("比較起日"), {
      target: { value: "2025-10-22" },
    });
    await waitFor(() =>
      expect(api.salesAnalytics).toHaveBeenLastCalledWith(
        expect.objectContaining({ compare_from: "2025-10-22" }),
      ),
    );
    await screen.findByText("訂購金額", { selector: "dt" });
    fireEvent.click(screen.getByRole("button", { name: "每日件數" }));
    expect(screen.getByRole("button", { name: "每日件數" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByText("每日明細與比較"));
    expect(
      screen.getByRole("columnheader", { name: "比較件數" }),
    ).toBeVisible();
    fireEvent.click(screen.getByText("商品規格明細（1 項）"));
    expect(screen.getByText("紀念衫 · 尺寸：L")).toBeVisible();
    fireEvent.click(screen.getByLabelText("比較等長期間"));
    await waitFor(() =>
      expect(api.salesAnalytics).toHaveBeenLastCalledWith(
        expect.objectContaining({ compare: "false" }),
      ),
    );
    expect(screen.queryByLabelText("比較起日")).not.toBeInTheDocument();
  });

  it("rejects stale results after filters change and supports recovery", async () => {
    let finish!: (result: ShopSalesAnalyticsOut) => void;
    api.salesAnalytics.mockReturnValueOnce(
      new Promise<ShopSalesAnalyticsOut>((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<ShopSalesAnalytics filters={{ product_id: "old" }} />);
    api.salesAnalytics.mockRejectedValueOnce(new Error("offline"));
    view.rerender(<ShopSalesAnalytics filters={{ product_id: "new" }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "分析資料載入失敗",
    );
    await act(async () => finish(fixture()));
    expect(
      screen.queryByText("訂購金額", { selector: "dt" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重試分析" }));
    await screen.findByText("訂購金額", { selector: "dt" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("refreshes on pushes, polls while visible, and cleans up when paused or unmounted", async () => {
    vi.useFakeTimers();
    const view = render(<ShopSalesAnalytics filters={{}} live />);
    await act(async () => {});
    expect(api.salesAnalytics).toHaveBeenCalledTimes(1);
    await act(async () => ws.callback({ type: "order.updated" }));
    expect(api.salesAnalytics).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(api.salesAnalytics).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByLabelText("每 30 秒更新"));
    await act(async () => {});
    const calls = api.salesAnalytics.mock.calls.length;
    expect(ws.room).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(api.salesAnalytics).toHaveBeenCalledTimes(calls);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("marks stale data on refresh failure, disables export, and explains an empty range", async () => {
    const empty = fixture();
    empty.current.metrics.order_count = 0;
    api.salesAnalytics.mockResolvedValueOnce(empty);
    const view = render(<ShopSalesAnalytics filters={{}} />);
    expect(await screen.findByText(/此範圍沒有有效訂單/)).toBeVisible();
    api.salesAnalytics.mockRejectedValueOnce(new Error("offline"));
    view.rerender(<ShopSalesAnalytics filters={{}} refresh={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("上次成功資料");
    expect(screen.getByRole("button", { name: "匯出分析 CSV" })).toBeDisabled();
  });

  it("exports every distribution and neutralizes spreadsheet formulas", async () => {
    const data = fixture();
    data.current.products[0].label = '=HYPERLINK("https://example.test")';
    api.salesAnalytics.mockResolvedValueOnce(data);
    let blob: Blob | undefined;
    vi.stubGlobal("URL", {
      createObjectURL: (value: Blob) => {
        blob = value;
        return "blob:analysis";
      },
      revokeObjectURL: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    render(<ShopSalesAnalytics filters={{}} />);
    await screen.findByText("訂購金額", { selector: "dt" });
    fireEvent.click(screen.getByRole("button", { name: "匯出分析 CSV" }));
    expect(click).toHaveBeenCalledOnce();
    const contents = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob!);
    });
    expect(contents).toContain("比較期");
    expect(contents).toContain("規格");
    expect(contents).toContain("'=HYPERLINK");
    click.mockRestore();
  });
});
