import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShopSalesAnalytics from "./ShopSalesAnalytics";
import type {
  ShopSalesAnalyticsOut,
  ShopSalesMetrics,
  ShopSalesPeriod,
} from "@/lib/types";

const api = vi.hoisted(() => ({
  salesAnalytics: vi.fn(),
  downloadSalesReport: vi.fn(),
}));
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
  median_order_amount: 125,
  average_buyer_amount: 250,
  repeat_buyer_count: 1,
  repeat_buyer_rate: 100,
};
const row = {
  gross_amount: 300,
  discount_amount: 50,
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
    weekdays: [row],
    weekday_hours: [{ ...row, key: "72", label: "週四 00:00" }],
    statuses: [{ ...row, key: "pending", label: "待確認" }],
    buyer_segments: [row],
    grade_products: [
      {
        ...row,
        key: "1:shirt",
        dimension_key: "1",
        dimension_label: "一年級",
        product_id: "shirt",
        product_name: "紀念衫",
      },
    ],
    class_products: [
      {
        ...row,
        key: "class:shirt",
        dimension_key: "class",
        dimension_label: "一年一班",
        product_id: "shirt",
        product_name: "紀念衫",
      },
    ],
  };
}
function fixture(): ShopSalesAnalyticsOut {
  return {
    generated_at: "2026-10-23T02:00:00Z",
    timezone: "Asia/Taipei",
    current: period(),
    previous: null,
    insights: [{ title: "商品集中度", detail: "紀念衫占本期金額 100%。" }],
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
  it("passes scoped filters without comparison controls and exposes daily and variant values", async () => {
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
        compare: "false",
      }),
    );
    expect(ws.room).toBe("shop:orders");
    expect(screen.queryByLabelText("比較起日")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("比較等長期間")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "每日件數" }));
    expect(screen.getByRole("button", { name: "每日件數" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByText("每日明細"));
    expect(
      within(
        screen.getByRole("table", { name: "每日訂單、件數與金額" }),
      ).getByRole("columnheader", { name: "件數" }),
    ).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "分析項目" }), {
      target: { value: "variants" },
    });
    expect(screen.getByText("紀念衫 · 尺寸：L")).toBeVisible();
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
    expect(contents).not.toContain("比較期");
    expect(contents).toContain("規格");
    expect(contents).toContain("'=HYPERLINK");
    click.mockRestore();
  });
});

it("shows real node dates, precise selected-period values by hover and keyboard", async () => {
  render(<ShopSalesAnalytics filters={{}} />);
  const chart = await screen.findByRole("slider", { name: "每日訂單" });
  expect(screen.queryByText("第 1 天")).not.toBeInTheDocument();
  fireEvent.focus(chart);
  let tooltip = screen.getByRole("tooltip");
  expect(tooltip).toHaveTextContent("2026/10/22");
  expect(tooltip).not.toHaveTextContent("比較期");
  expect(tooltip).toHaveTextContent("NT$250");
  fireEvent.keyDown(chart, { key: "ArrowRight" });
  expect(screen.getByRole("tooltip")).toHaveTextContent("2026/10/23");
  expect(chart).toHaveAttribute(
    "aria-valuetext",
    expect.stringContaining("2026-10-23"),
  );
  fireEvent.keyDown(chart, { key: "Home" });
  expect(screen.getByRole("tooltip")).toHaveTextContent("2026/10/22");
  fireEvent.keyDown(chart, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 285,
    width: 1000,
    height: 285,
    toJSON: () => ({}),
  });
  fireEvent.pointerMove(chart, { clientX: 950 });
  tooltip = screen.getByRole("tooltip");
  expect(tooltip).toHaveTextContent("2026/10/23");
});

it("explores cross cells, changes table dimension, and sorts by unpaid values", async () => {
  const data = fixture();
  data.current.products.push({
    ...row,
    key: "bag",
    label: "帆布袋",
    total_amount: 100,
    paid_amount: 0,
  });
  api.salesAnalytics.mockResolvedValueOnce(data);
  render(<ShopSalesAnalytics filters={{}} />);
  await screen.findByText("訂購金額", { selector: "dt" });
  fireEvent.change(screen.getByRole("combobox", { name: "排序依據" }), {
    target: { value: "unpaid" },
  });
  const table = screen.getByRole("table", { name: "分項分析與排行明細" });
  expect(table.querySelector("tbody tr th")).toHaveTextContent("帆布袋");
  fireEvent.change(screen.getByRole("searchbox", { name: "搜尋項目" }), {
    target: { value: "紀念衫" },
  });
  expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "一年級 × 紀念衫，3" }));
  expect(screen.getByText(/本期 2 筆 · 1 人 · 3 件/)).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "分析項目" }), {
    target: { value: "statuses" },
  });
  expect(screen.getByRole("rowheader", { name: "待確認" })).toBeVisible();
});

it("downloads generated PDF or Excel with scoped filters and retries report errors", async () => {
  const createObjectURL = vi.fn(() => "blob:report");
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  api.downloadSalesReport.mockRejectedValueOnce(new Error("offline"));
  api.downloadSalesReport.mockResolvedValue({
    blob: async () => new Blob(["report"]),
    headers: new Headers({
      "Content-Disposition": "attachment; filename*=UTF-8''sales.pdf",
    }),
  });
  render(
    <ShopSalesAnalytics
      filters={{
        activity_id: "festival",
        product_id: "shirt",
        is_paid: "false",
        grade: "1",
      }}
    />,
  );
  await screen.findByText("訂購金額", { selector: "dt" });
  fireEvent.click(screen.getByRole("button", { name: "產生並下載報告" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("報告產生失敗");
  fireEvent.change(screen.getByRole("combobox", { name: "報告格式" }), {
    target: { value: "xlsx" },
  });
  fireEvent.click(screen.getByRole("button", { name: "產生並下載報告" }));
  await screen.findByText(/Excel 報告已產生並開始下載/);
  expect(api.downloadSalesReport).toHaveBeenLastCalledWith(
    expect.objectContaining({
      format: "xlsx",
      activity_id: "festival",
      product_id: "shirt",
      is_paid: false,
      grade: 1,
      date_from: "2026-10-22",
    }),
  );
  expect(click).toHaveBeenCalledOnce();
  expect(createObjectURL).toHaveBeenCalledOnce();
  click.mockRestore();
});

it("keeps the last date tooltip inside a narrow horizontally scrolled chart", async () => {
  render(<ShopSalesAnalytics filters={{}} />);
  const chart = await screen.findByRole("slider", { name: "每日訂單" });
  const scroller = chart.closest(".sales-chart-scroll") as HTMLDivElement;
  Object.defineProperty(scroller, "clientWidth", {
    configurable: true,
    value: 300,
  });
  Object.defineProperty(scroller, "scrollWidth", {
    configurable: true,
    value: 1000,
  });
  vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 285,
    width: 1000,
    height: 285,
    toJSON: () => ({}),
  });
  fireEvent.focus(chart);
  fireEvent.keyDown(chart, { key: "End" });
  const tooltip = screen.getByRole("tooltip");
  expect(tooltip).toHaveTextContent("2026/10/23");
  const left = Number.parseFloat(tooltip.style.left) - scroller.scrollLeft;
  expect(scroller.scrollLeft).toBeGreaterThan(0);
  expect(left).toBeGreaterThanOrEqual(0);
  expect(left + 260).toBeLessThanOrEqual(scroller.clientWidth);
});
