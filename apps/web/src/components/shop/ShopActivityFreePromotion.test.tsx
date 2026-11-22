import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";

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
  api.listCategories.mockResolvedValue([{ id: "festival", name: "校慶活動" }]);
  api.listSeries.mockResolvedValue([]);
  api.listProducts.mockResolvedValue([
    { id: "shirt", name: "紀念衣", price: 300, category_id: "festival", status: "active" },
  ]);
  api.createPromotion.mockResolvedValue({});
  api.updatePromotion.mockResolvedValue({});
  api.lookupTargets.mockResolvedValue([]);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
});

it("切換活動免費券會清除送出的商品、門檻、次數與優惠碼限制", async () => {
  render(<ShopPromotionPanel />);
  fireEvent.click(await screen.findByRole("checkbox", { name: /紀念衣/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "優惠名稱" }), { target: { value: "幹部活動免費券" } });
  fireEvent.change(screen.getByRole("textbox", { name: "優惠碼（選填）" }), { target: { value: "OLD" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /每個活動最低消費/ }), { target: { value: "500" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /最低件數/ }), { target: { value: "3" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: /使用次數上限/ }), { target: { value: "1" } });
  fireEvent.change(screen.getByRole("combobox", { name: "優惠內容" }), { target: { value: "activity_free" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "校慶活動" }));
  fireEvent.click(screen.getByText("批次輸入學號或 Email"));
  fireEvent.change(screen.getByRole("textbox", { name: /可使用帳號（必填）/ }), { target: { value: "410001\n410002" } });
  expect(screen.queryByRole("checkbox", { name: "不限活動" })).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "適用商品（可複選）" })).not.toBeInTheDocument();
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(screen.getByText(/含所有數量、規格加價/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "建立優惠" }));
  await waitFor(() => expect(api.createPromotion).toHaveBeenCalledWith(expect.objectContaining({
    target_category_ids: ["festival"], target_identifiers: ["410001", "410002"],
    target_product_ids: [], product_price_overrides: [], code: null,
    discount_type: "percentage", discount_value: 100, min_order_price: 0,
    min_quantity: 1, max_uses: null, is_public: false,
  })));
});

it("免費券必須選擇活動與人員，避免誤建成所有人或所有活動全免", async () => {
  render(<ShopPromotionPanel />);
  await screen.findByRole("checkbox", { name: "校慶活動" });
  fireEvent.change(screen.getByRole("textbox", { name: "優惠名稱" }), { target: { value: "活動免費券" } });
  fireEvent.change(screen.getByRole("combobox", { name: "優惠內容" }), { target: { value: "activity_free" } });
  fireEvent.click(screen.getByRole("button", { name: "建立優惠" }));
  expect(toast.error).toHaveBeenLastCalledWith("活動免費券請至少選擇一個適用活動");
  fireEvent.click(screen.getByRole("checkbox", { name: "校慶活動" }));
  fireEvent.click(screen.getByRole("button", { name: "建立優惠" }));
  expect(toast.error).toHaveBeenLastCalledWith("活動免費券請指定可使用帳號");
  expect(api.createPromotion).not.toHaveBeenCalled();
});

it("免費券重開編輯保留活動、人員與不限次數設定", async () => {
  api.listPromotions.mockResolvedValue([{
    id: "free", name: "幹部活動免費券", target_category_ids: ["festival"],
    target_users: [{ student_id: "410001", email: null }], target_products: [],
    discount_type: "percentage", discount_value: 100, min_order_price: 0, min_quantity: 1,
    code: null, max_uses: null, used_count: 20, is_active: true, is_public: false,
  }]);
  render(<ShopPromotionPanel />);
  expect(await screen.findByText(/全品項與規格加價全免/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "編輯" }));
  expect(screen.getByRole("combobox", { name: "優惠內容" })).toHaveValue("activity_free");
  const topics = screen.getByRole("group", { name: "適用活動（必填，可複選）" });
  expect(within(topics).getByRole("checkbox", { name: "校慶活動" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "儲存變更" }));
  await waitFor(() => expect(api.updatePromotion).toHaveBeenCalledWith("free", expect.objectContaining({
    target_category_ids: ["festival"], target_identifiers: ["410001"],
    target_product_ids: [], discount_value: 100, max_uses: null,
  })));
});
