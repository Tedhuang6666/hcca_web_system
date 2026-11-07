import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import ShopPromotionPanel from "@/app/(protected)/shop/admin/ShopPromotionPanel";

const api = vi.hoisted(() => ({
  listPromotions: vi.fn(), listProducts: vi.fn(), listCategories: vi.fn(), listSeries: vi.fn(),
  createPromotion: vi.fn(), updatePromotion: vi.fn(), lookupTargets: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ shopApi: api, apiErrorMessage: (_: unknown, fallback: string) => fallback }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  api.listPromotions.mockResolvedValue([]);
  api.listCategories.mockResolvedValue([
    { id: "clothes", name: "紀念服飾", activity_id: "festival" },
    { id: "gifts", name: "紀念用品", activity_id: "festival" },
  ]);
  api.listSeries.mockResolvedValue([{ id: "gift-series", category_id: "gifts" }]);
  api.listProducts.mockResolvedValue([
    { id: "shirt", name: "紀念衣", price: 300, category_id: "clothes", status: "active" },
    { id: "cup", name: "紀念杯", price: 200, category_id: null, series_id: "gift-series", status: "active" },
  ]);
  api.createPromotion.mockResolvedValue({});
  api.updatePromotion.mockResolvedValue({});
  api.lookupTargets.mockResolvedValue([]);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
});

it("預設不限主題，分別列出同一活動的兩個商品主題並說明門檻分開計算", async () => {
  render(<ShopPromotionPanel />);
  const topics = await screen.findByRole("group", { name: "適用商品主題（選填，可複選）" });
  expect(within(topics).getByRole("checkbox", { name: "不限商品主題" })).toBeChecked();
  expect(await within(topics).findByRole("checkbox", { name: "紀念服飾" })).not.toBeChecked();
  expect(within(topics).getByRole("checkbox", { name: "紀念用品" })).not.toBeChecked();
  expect(screen.queryByText("適用活動")).not.toBeInTheDocument();
  expect(screen.getByText(/滿額與最低件數依各主題分開計算/)).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: "優惠名稱" }), { target: { value: "各主題滿額優惠" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "每個主題最低消費（選填）" }), { target: { value: "500" } });
  fireEvent.click(screen.getByRole("button", { name: "建立優惠" }));
  await waitFor(() => expect(api.createPromotion).toHaveBeenCalledWith(expect.objectContaining({
    activity_id: null, target_category_ids: [], min_order_price: 500,
  })));
});

it("可在同一優惠選取多個主題的商品並逐項設定幹部價", async () => {
  render(<ShopPromotionPanel />);
  const topics = await screen.findByRole("group", { name: "適用商品主題（選填，可複選）" });
  fireEvent.click(await within(topics).findByRole("checkbox", { name: "紀念服飾" }));
  const products = screen.getByRole("group", { name: "適用商品（可複選）" });
  fireEvent.click(within(products).getByRole("checkbox", { name: /紀念衣/ }));
  expect(within(products).queryByRole("checkbox", { name: /紀念杯/ })).not.toBeInTheDocument();
  fireEvent.click(within(topics).getByRole("checkbox", { name: "紀念用品" }));
  expect(within(products).getByRole("checkbox", { name: /紀念衣/ })).toBeChecked();
  fireEvent.click(within(products).getByRole("checkbox", { name: /紀念杯/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "優惠內容" }), { target: { value: "price_override" } });
  fireEvent.change(screen.getByRole("textbox", { name: "優惠名稱" }), { target: { value: "幹部價" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "紀念衣 優惠後單價" }), { target: { value: "100" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "紀念杯 優惠後單價" }), { target: { value: "50" } });
  fireEvent.click(screen.getByRole("button", { name: "建立優惠" }));
  await waitFor(() => expect(api.createPromotion).toHaveBeenCalledWith(expect.objectContaining({
    target_category_ids: ["clothes", "gifts"], target_product_ids: ["shirt", "cup"],
    discount_type: "price_override", product_price_overrides: [
      { product_id: "shirt", unit_price: 100 }, { product_id: "cup", unit_price: 50 },
    ],
  })));
});

it("編輯時保留主題限制，移除主題時移除範圍外的商品與價格", async () => {
  api.listPromotions.mockResolvedValue([{
    id: "promo", name: "幹部價", target_category_ids: ["clothes", "gifts"],
    target_users: [], target_products: [{ id: "shirt", name: "紀念衣" }, { id: "cup", name: "紀念杯" }],
    product_price_overrides: [{ product_id: "shirt", unit_price: 100 }, { product_id: "cup", unit_price: 50 }],
    discount_type: "price_override", discount_value: 0, min_order_price: 0, min_quantity: 1,
    max_uses: null, used_count: 0, is_active: true, is_public: true,
  }]);
  render(<ShopPromotionPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "編輯" }));
  const topics = screen.getByRole("group", { name: "適用商品主題（選填，可複選）" });
  expect(within(topics).getByRole("checkbox", { name: "紀念用品" })).toBeChecked();
  fireEvent.click(within(topics).getByRole("checkbox", { name: "紀念用品" }));
  fireEvent.click(screen.getByRole("button", { name: "儲存變更" }));
  await waitFor(() => expect(api.updatePromotion).toHaveBeenCalledWith("promo", expect.objectContaining({
    target_category_ids: ["clothes"], target_product_ids: ["shirt"],
    product_price_overrides: [{ product_id: "shirt", unit_price: 100 }],
  })));
});
