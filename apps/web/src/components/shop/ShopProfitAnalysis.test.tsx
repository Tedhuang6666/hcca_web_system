import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ShopProfitOut, ShopProfitProduct } from "@/lib/types";
import ShopProfitAnalysis from "./ShopProfitAnalysis";
import { profitCsv, stockScenario } from "./shop-profit";

const api = vi.hoisted(() => ({ listCategories: vi.fn(), profitAnalysis: vi.fn(), saveProcurement: vi.fn() }));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));

function product(): ShopProfitProduct {
  return {
    product_id: "shirt", name: "紀念衫", price: 100,
    option_cost: 0, options: [],
    plan: { unit_cost: 40, minimum_order_quantity: 10, stock_extra_quantity: 2, reserve_quantity: 1, supplier_gift_quantity: 0, extra_cost: 50, note: "備品不出售" },
    ordered_quantity: 3, revenue: 240, paid_amount: 240, purchase_quantity: 10,
    minimum_top_up_quantity: 4, sellable_stock_quantity: 6, order_cost: 120,
    inventory_cost: 240, reserve_cost: 40, total_cost: 450, profit_amount: -210, cash_balance: -210,
  };
}
function fixture(): ShopProfitOut {
  return {
    category_id: "shirts", category_name: "服飾活動", generated_at: "2026-11-05T04:00:00Z",
    products: [product()],
    summary: { ordered_quantity: 3, purchase_quantity: 10, sellable_stock_quantity: 6,
      reserve_quantity: 1, supplier_gift_quantity: 0, minimum_top_up_quantity: 4, revenue: 240, paid_amount: 240,
      unpaid_amount: 0, extra_cost: 50, missing_cost_product_count: 0, order_cost: 120,
      inventory_cost: 240, reserve_cost: 40, total_cost: 450, profit_amount: -210, cash_balance: -210 },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  api.listCategories.mockResolvedValue([{ id: "shirts", name: "服飾活動" }, { id: "cards", name: "卡片活動" }]);
  api.profitAnalysis.mockResolvedValue(fixture());
  api.saveProcurement.mockResolvedValue({});
});

it("廠商贈品可編輯、失敗保留並重試，重算後呈現及匯出", async () => {
  const data = fixture();
  data.products[0].plan.supplier_gift_quantity = 2;
  data.products[0].minimum_top_up_quantity = 6;
  data.products[0].sellable_stock_quantity = 8;
  data.products[0].order_cost = 40;
  data.products[0].inventory_cost = 320;
  data.summary.supplier_gift_quantity = 2;
  data.summary.minimum_top_up_quantity = 6;
  data.summary.sellable_stock_quantity = 8;
  data.summary.order_cost = 40;
  data.summary.inventory_cost = 320;
  api.profitAnalysis.mockResolvedValueOnce(fixture()).mockResolvedValue(data);
  api.saveProcurement.mockRejectedValueOnce(new Error("offline"));
  render(<ShopProfitAnalysis />);
  fireEvent.click(await screen.findByRole("button", { name: "編輯紀念衫採購設定" }));
  const field = screen.getByRole("spinbutton", { name: /^廠商贈品數量/ });
  expect(field).toHaveValue(0);
  expect(field).not.toHaveAttribute("aria-describedby");
  fireEvent.change(field, { target: { value: "2" } });
  fireEvent.submit(screen.getByRole("form"));
  await screen.findByRole("alert");
  expect(field).toHaveValue(2);
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(api.saveProcurement).toHaveBeenLastCalledWith("shirt",
    expect.objectContaining({ supplier_gift_quantity: 2 })));
  expect(await screen.findByText("訂單 3 件 · 付費採購 10 件 · 廠商贈品 2 件")).toBeVisible();
  const csv = profitCsv(data.products, data.category_name);
  expect(csv).toContain('"廠商贈品（零本體成本）"');
  expect(csv).toContain('"3","2","6","10","8"');
});

it("整批盈利獨立分析單一完整活動，呈現備品與可售庫存並可試算回本", async () => {
  render(<ShopProfitAnalysis />);
  const row = await screen.findByRole("article", { name: "紀念衫盈利分析" });
  expect(api.profitAnalysis).toHaveBeenCalledWith("shirts");
  expect(screen.getByText("距離整批回本還差 NT$210。可展開商品查看庫存售出試算。")).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "年級" })).not.toBeInTheDocument();
  const scope = within(row);
  fireEvent.click(scope.getByText(/庫存售出與回本試算/));
  expect(scope.getByText("以此售價再售出 3 件即可回本。")).toBeVisible();
  fireEvent.change(scope.getByRole("spinbutton", { name: "模擬售出件數" }), { target: { value: "3" } });
  expect(scope.getByText("NT$90")).toBeVisible();
  fireEvent.click(scope.getByRole("button", { name: "試算全部餘貨售出" }));
  expect(scope.getByRole("spinbutton", { name: "模擬售出件數" })).toHaveValue(6);
  expect(scope.getByText("NT$390")).toBeVisible();
  fireEvent.change(scope.getByRole("spinbutton", { name: "模擬每件售價（NT$）" }), { target: { value: "0" } });
  expect(scope.getByText("售價為零，無法透過售出餘貨回本。")).toBeVisible();
});

it("儲存完整採購設定，重算資料並保留零成本與 null 的差異", async () => {
  const view = render(<ShopProfitAnalysis />);
  fireEvent.click(await screen.findByRole("button", { name: "編輯紀念衫採購設定" }));
  expect(screen.getByRole("combobox", { name: "盈利分析活動" })).toBeDisabled();
  const form = screen.getByRole("form", { name: "紀念衫採購設定" });
  fireEvent.change(within(form).getByRole("spinbutton", { name: "單位成本（NT$；留空為未知）" }), { target: { value: "" } });
  fireEvent.change(within(form).getByRole("spinbutton", { name: "廠商起訂量（件）" }), { target: { value: "20" } });
  fireEvent.change(within(form).getByRole("textbox", { name: "採購備註" }), { target: { value: "加購" } });
  fireEvent.submit(form);
  await waitFor(() => expect(api.saveProcurement).toHaveBeenCalledWith("shirt", {
    unit_cost: null, minimum_order_quantity: 20, stock_extra_quantity: 2, reserve_quantity: 1, supplier_gift_quantity: 0, extra_cost: 50, note: "加購",
  }));
  await waitFor(() => expect(api.profitAnalysis).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("combobox", { name: "盈利分析活動" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "編輯紀念衫採購設定" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "單位成本（NT$；留空為未知）" }), { target: { value: "0" } });
  fireEvent.submit(screen.getByRole("form", { name: "紀念衫採購設定" }));
  await waitFor(() => expect(api.saveProcurement).toHaveBeenLastCalledWith("shirt", expect.objectContaining({ unit_cost: 0 })));
  view.unmount();
});

it("儲存失敗時保留草稿、聚焦錯誤並能重試", async () => {
  api.saveProcurement.mockRejectedValueOnce(new Error("offline"));
  render(<ShopProfitAnalysis />);
  fireEvent.click(await screen.findByRole("button", { name: "編輯紀念衫採購設定" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "不可售備用品（件）" }), { target: { value: "9" } });
  fireEvent.submit(screen.getByRole("form", { name: "紀念衫採購設定" }));
  const alert = await screen.findByRole("alert");
  await waitFor(() => expect(alert).toHaveFocus());
  expect(screen.getByRole("spinbutton", { name: "不可售備用品（件）" })).toHaveValue(9);
  fireEvent.submit(screen.getByRole("form", { name: "紀念衫採購設定" }));
  await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());
});

it("成本缺漏不顯示假盈利，空活動不發出分析", async () => {
  const data = fixture();
  data.summary.profit_amount = data.summary.total_cost = null;
  data.summary.missing_cost_product_count = 1;
  api.profitAnalysis.mockResolvedValue(data);
  const view = render(<ShopProfitAnalysis />);
  expect(await screen.findByText("1 項商品的本體或已訂購選項尚未設定成本，總盈利暫不估算。")).toBeVisible();
  view.unmount();
  api.profitAnalysis.mockClear();
  api.listCategories.mockResolvedValue([]);
  render(<ShopProfitAnalysis />);
  expect(await screen.findByText("尚無可分析的活動。")).toBeVisible();
  expect(api.profitAnalysis).not.toHaveBeenCalled();
});

it("活動載入與分析失敗可分別重試", async () => {
  api.listCategories.mockRejectedValueOnce(new Error("offline"));
  api.profitAnalysis.mockRejectedValueOnce(new Error("offline"));
  render(<ShopProfitAnalysis />);
  fireEvent.click(await screen.findByRole("button", { name: "重試活動" }));
  fireEvent.click(await screen.findByRole("button", { name: "重試盈利分析" }));
  expect(await screen.findByRole("article", { name: "紀念衫盈利分析" })).toBeVisible();
});

it("切換活動清除舊資料並忽略過時回應", async () => {
  let finish!: (data: ShopProfitOut) => void;
  api.profitAnalysis.mockReturnValueOnce(new Promise<ShopProfitOut>((resolve) => { finish = resolve; }));
  const next = fixture();
  next.category_id = "cards";
  next.category_name = "卡片活動";
  next.products = [];
  api.profitAnalysis.mockResolvedValueOnce(next);
  render(<ShopProfitAnalysis />);
  await waitFor(() => expect(api.profitAnalysis).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole("combobox", { name: "盈利分析活動" }), { target: { value: "cards" } });
  expect(await screen.findByText("此活動尚無商品，請先到商品管理建立商品。")).toBeVisible();
  await act(async () => { finish(fixture()); });
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
});

it("試算不把備品出售，零售價與成本缺漏無法計算回本", () => {
  const row = product();
  expect(stockScenario(row, 3, 100)).toEqual({ extraRevenue: 300, profit: 90, breakEvenUnits: 3 });
  expect(stockScenario(row, 6, 0).breakEvenUnits).toBeNull();
  row.profit_amount = null;
  expect(stockScenario(row, 6, 100).profit).toBeNull();
  row.profit_amount = 0;
  expect(stockScenario(row, 0, 0).breakEvenUnits).toBe(0);
});

it("CSV 匯出包含整批規劃且防止商品或備註變成試算表公式", () => {
  const row = product();
  row.name = '=HYPERLINK("https://example.test")';
  row.plan.note = " @SUM(1,2)\n多行";
  const csv = profitCsv([row], "活動");
  expect(csv).toContain("不可售備用品");
  expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
  expect(csv).toContain("' @SUM(1,2)\n多行");
  expect(csv).toContain('"-210"');
});

it("選項可填額外成本，保留零值與未知，失敗重試後重算盈利", async () => {
  const data = fixture();
  data.products[0].options = [{ key: "id:xl", group_name: "尺寸", value: "XL",
    unit_cost: null, ordered_quantity: 3, total_cost: null }];
  data.products[0].option_cost = data.products[0].profit_amount = null;
  api.profitAnalysis.mockResolvedValue(data);
  api.saveProcurement.mockRejectedValueOnce(new Error("offline"));
  render(<ShopProfitAnalysis />);
  fireEvent.click(await screen.findByRole("button", { name: "編輯紀念衫採購設定" }));
  const field = screen.getByRole("spinbutton", { name: /尺寸：XL 額外單位成本/ });
  expect(field).toHaveValue(null);
  fireEvent.change(field, { target: { value: "0" } });
  fireEvent.submit(screen.getByRole("form"));
  await screen.findByRole("alert");
  expect(field).toHaveValue(0);
  expect(api.saveProcurement).toHaveBeenLastCalledWith("shirt", expect.objectContaining({ option_costs: { "id:xl": 0 } }));
  fireEvent.change(field, { target: { value: "" } });
  fireEvent.submit(screen.getByRole("form"));
  await waitFor(() => expect(api.saveProcurement).toHaveBeenLastCalledWith("shirt", expect.objectContaining({ option_costs: { "id:xl": null } })));
  await waitFor(() => expect(api.profitAnalysis).toHaveBeenCalledTimes(2));
});

it("CSV 同時匯出選項成本與逐選項明細", () => {
  const row = product();
  row.option_cost = 12;
  row.options = [{ key: "id:xl", group_name: "尺寸", value: "=XL", unit_cost: 4,
    ordered_quantity: 3, total_cost: 12 }];
  const csv = profitCsv([row], "活動");
  expect(csv).toContain('"訂單選項成本"');
  expect(csv).toContain('"紀念衫","尺寸","\'=XL","4","3","12"');
});
