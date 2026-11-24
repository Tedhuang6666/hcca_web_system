import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderPurchaseDetailRow, OrderQuantityRow, OrderSummaryOut } from "@/lib/types";

import ShopPrintReports from "./ShopPrintReports";

const api = vi.hoisted(() => ({
  orderSummary: vi.fn(),
  purchaseDetails: vi.fn(),
  orderQuantities: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  shopApi: {
    orderSummary: api.orderSummary,
    purchaseDetails: api.purchaseDetails,
    orderQuantities: api.orderQuantities,
  },
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

const summary: OrderSummaryOut = {
  group_by: "class",
  rows: [{
    key: "class-1",
    label: "高一一班",
    order_count: 2,
    item_count: 3,
    total_amount: 300,
    paid_amount: 100,
    unpaid_amount: 200,
  }],
  total_amount: 300,
  paid_amount: 100,
  unpaid_amount: 200,
};

const details: OrderPurchaseDetailRow[] = [{
  class_id: "class-1",
  class_label: "高一一班",
  grade: 1,
  class_code: "101",
  user_id: "user-1",
  buyer_label: "林同學",
  product_id: "hoodie",
  product_name: "班服帽踢",
  variant_key: "尺寸：M",
  quantity: 2,
  order_count: 1,
}];

const quantities: OrderQuantityRow[] = [{
  product_id: "hoodie",
  product_name: "班服帽踢",
  series_name: "冬季服飾",
  variant_key: "尺寸：M",
  qty_total: 5,
  qty_paid: 2,
}];

describe("ShopPrintReports", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.orderSummary.mockResolvedValue(summary);
    api.purchaseDetails.mockResolvedValue(details);
    api.orderQuantities.mockResolvedValue(quantities);
  });

  it("provides printable class, person, and council quantity reports", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const filters = { category_id: "shirts", is_paid: "false" };
    render(<ShopPrintReports filters={filters} scope="商品活動 · 班聯未確認" />);

    expect(await screen.findByRole("heading", { name: "各班總數統計" })).toBeVisible();
    expect(api.orderSummary).toHaveBeenCalledWith({ group_by: "class", ...filters });

    const reportType = screen.getByRole("combobox", { name: "報表類型" });
    fireEvent.change(reportType, { target: { value: "people" } });
    expect(await screen.findByRole("heading", { name: "各班個人購買明細" })).toBeVisible();
    expect(await screen.findByText("林同學")).toBeVisible();
    expect(api.purchaseDetails).toHaveBeenCalledWith(filters);

    fireEvent.change(reportType, { target: { value: "council" } });
    expect(await screen.findByRole("heading", { name: "班聯商品尺寸總表" })).toBeVisible();
    expect(await screen.findByText("班服帽踢")).toBeVisible();
    expect(screen.getByText("未繳件數")).toBeVisible();
    expect(api.orderQuantities).toHaveBeenCalledWith(filters);

    await waitFor(() => expect(screen.getByRole("button", { name: "列印報表" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "列印報表" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("shows a recoverable load error", async () => {
    api.orderSummary.mockRejectedValueOnce(new Error("offline"));
    render(<ShopPrintReports filters={{}} scope="全部活動" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("報表載入失敗");
    fireEvent.click(screen.getByRole("button", { name: "重新載入報表" }));
    expect(await screen.findByRole("heading", { name: "各班總數統計" })).toBeVisible();
  });
});
