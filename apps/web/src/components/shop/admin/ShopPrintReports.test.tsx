import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderPurchaseDetailRow, OrderQuantityRow, OrderSummaryOut } from "@/lib/types";

import ShopPrintReports from "./ShopPrintReports";

const api = vi.hoisted(() => ({
  orderSummary: vi.fn(),
  purchaseDetails: vi.fn(),
  orderQuantities: vi.fn(),
  downloadPrintReportPdf: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  shopApi: {
    orderSummary: api.orderSummary,
    purchaseDetails: api.purchaseDetails,
    orderQuantities: api.orderQuantities,
    downloadPrintReportPdf: api.downloadPrintReportPdf,
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
    api.downloadPrintReportPdf.mockResolvedValue({
      blob: vi.fn().mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" })),
    });
  });

  it("shows only the remaining reports with PDF as the only export action", async () => {
    const filters = { category_id: "shirts", is_paid: "false" };
    render(<ShopPrintReports filters={filters} scope="商品活動 · 班聯未確認" titleScope="商品分類" />);

    expect(await screen.findByRole("heading", { name: "班級訂購明細" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "列印" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下載 Word" })).not.toBeInTheDocument();

    const reportType = screen.getByRole("combobox", { name: "報表類型" });
    expect(Array.from(reportType.querySelectorAll("option"), (option) => option.textContent)).toEqual([
      "班級訂購明細",
      "各班總數明細",
      "班聯商品尺寸總表",
    ]);
    expect(api.purchaseDetails).toHaveBeenCalledWith(filters);
    expect(await screen.findByText("林同學")).toBeVisible();
    expect(screen.getByText("班服帽踢（尺寸：M） × 2")).toBeVisible();

    fireEvent.change(reportType, { target: { value: "council" } });
    expect(await screen.findByRole("heading", { name: "班聯商品尺寸總表" })).toBeVisible();
    expect(await screen.findByText("班服帽踢")).toBeVisible();
    expect(screen.getByText("未繳件數")).toBeVisible();
    expect(api.orderQuantities).toHaveBeenCalledWith(filters);

  });

  it("downloads class totals as PDF and no other format", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:report");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ShopPrintReports filters={{ category_id: "theme-1" }} scope="校慶商品" titleScope="校慶商品" />);

    await screen.findByRole("heading", { name: "班級訂購明細" });
    fireEvent.change(screen.getByRole("combobox", { name: "報表類型" }), {
      target: { value: "class-totals" },
    });
    const download = await screen.findByRole("button", { name: "下載 PDF" });
    expect(download).toBeEnabled();
    expect(screen.queryByRole("button", { name: "列印" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下載 Word" })).not.toBeInTheDocument();

    fireEvent.click(download);
    await waitFor(() => {
      expect(api.downloadPrintReportPdf).toHaveBeenCalledWith(
        "class-totals",
        { category_id: "theme-1" },
        "校慶商品",
      );
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(click).toHaveBeenCalledOnce();
    });
  });

  it("downloads the selected report as a PDF", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:report");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const filters = { category_id: "theme-1" };
    render(<ShopPrintReports filters={filters} scope="校慶商品 · 班聯未確認" titleScope="校慶商品" />);

    await screen.findByRole("heading", { name: "班級訂購明細" });
    fireEvent.click(screen.getByRole("button", { name: "下載 PDF" }));

    await waitFor(() => {
      expect(api.downloadPrintReportPdf).toHaveBeenCalledWith("class-sheet", filters, "校慶商品");
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(click).toHaveBeenCalledOnce();
    });
  });

  it("shows a recoverable load error", async () => {
    api.purchaseDetails.mockRejectedValueOnce(new Error("offline"));
    render(<ShopPrintReports filters={{}} scope="全部活動" titleScope="全部主題" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("報表載入失敗");
    fireEvent.click(screen.getByRole("button", { name: "重新載入報表" }));
    expect(await screen.findByRole("heading", { name: "班級訂購明細" })).toBeVisible();
  });
});
