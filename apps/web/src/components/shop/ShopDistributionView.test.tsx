import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderDistributionRow, ProductOut } from "@/lib/types";
import ShopDistributionView from "./ShopDistributionView";

const api = vi.hoisted(() => ({
  orderDistribution: vi.fn(),
  recipientOptions: vi.fn(),
  listProductChoices: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  shopApi: { orderDistribution: api.orderDistribution },
  classApi: { recipientOptions: api.recipientOptions },
  apiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock("@/lib/shop-admin-data", () => ({ listProductChoices: api.listProductChoices }));

const product = { id: "hoodie", name: "班服帽踢" } as ProductOut;
const rows: OrderDistributionRow[] = [
  {
    product_id: "hoodie",
    product_name: "班服帽踢",
    series_name: "冬季服飾",
    class_id: "class-a",
    class_label: "高一一班",
    grade: 1,
    variant_key: "尺寸:M",
    qty_total: 2,
  },
  {
    product_id: "hoodie",
    product_name: "班服帽踢",
    series_name: "冬季服飾",
    class_id: "class-a",
    class_label: "高一一班",
    grade: 1,
    variant_key: "尺寸:L",
    qty_total: 1,
  },
  {
    product_id: "hoodie",
    product_name: "班服帽踢",
    series_name: "冬季服飾",
    class_id: "class-b",
    class_label: "高一二班",
    grade: 1,
    variant_key: "尺寸:M",
    qty_total: 3,
  },
];

describe("ShopDistributionView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listProductChoices.mockResolvedValue([product]);
    api.recipientOptions.mockResolvedValue([
      { id: "class-a", class_code: "101", grade: 1, label: "高一一班" },
      { id: "class-b", class_code: "102", grade: 1, label: "高一二班" },
    ]);
    api.orderDistribution.mockResolvedValue(rows);
  });

  it("依商品和班級篩選，並以規格欄對照各班數量", async () => {
    render(<ShopDistributionView refreshKey={0} />);

    expect(await screen.findByRole("columnheader", { name: "尺寸:M" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "尺寸:L" })).toBeVisible();
    const firstClass = screen.getByRole("row", { name: /高一一班/ });
    expect(within(firstClass).getByText("2")).toBeVisible();
    expect(within(firstClass).getByText("1")).toBeVisible();

    fireEvent.change(screen.getByLabelText("商品"), { target: { value: "hoodie" } });
    await waitFor(() => expect(api.orderDistribution).toHaveBeenLastCalledWith({ product_id: "hoodie" }));
    fireEvent.change(screen.getByLabelText("班級"), { target: { value: "class-b" } });
    await waitFor(() => expect(api.orderDistribution).toHaveBeenLastCalledWith({
      product_id: "hoodie",
      class_id: "class-b",
    }));
  });

  it("顯示空資料，載入失敗後可以重試", async () => {
    api.orderDistribution.mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([]);
    render(<ShopDistributionView refreshKey={0} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("分貨數量載入失敗。");
    fireEvent.click(screen.getByRole("button", { name: "重新載入分貨數量" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("目前沒有符合篩選的訂購數量。"));
  });
});
