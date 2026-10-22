import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import ShopPage from "@/app/(protected)/shop/page";
import type { OrderOut } from "@/lib/types";

const api = vi.hoisted(() => ({
  me: vi.fn(), catalog: vi.fn(), getCurrentRegistrations: vi.fn(), listAvailablePromotions: vi.fn(),
  getProduct: vi.fn(), setCurrentRegistrationProduct: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  authApi: { refresh: api.me }, shopApi: api,
  classApi: { myClass: vi.fn().mockResolvedValue(null) },
  apiErrorMessage: (error: Error) => error.message,
}));
vi.mock("@/hooks/useWS", () => ({ useWS: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) => (
    <a {...props} onClick={(event) => { event.preventDefault(); props.onClick?.(event); }}>{children}</a>
  ),
}));
vi.mock("@/lib/api-cache", () => ({ cacheGet: () => null, cacheHas: () => false, cacheSet: vi.fn() }));

const testingProduct = {
  id: "testing", name: "測試限定商品", price: 100, image_url: null, status: "testing" as const,
  is_unlimited: false, stock_quantity: 4, has_variants: false, requires_seating: false,
  sale_start: "2099-01-01T00:00:00Z", sale_end: null,
};
const formalProduct = { ...testingProduct, id: "formal", name: "正式商品", status: "active" as const, sale_start: null };
const formalOrder: OrderOut = {
  id: "formal-order", user_id: "tester", activity_id: "festival", status: "pending",
  serial_number: "FORMAL-001", created_at: "2026-10-22T00:00:00Z", updated_at: "2026-10-22T00:00:00Z",
  assistance_scope: "self", payment_method: "cash_on_pickup",
  total_price: 200, subtotal_price: 200, discount_amount: 0, is_paid: false, is_class_collected: false,
  items: [{ id: "formal-item", product_id: "formal", product_name: "正式商品", quantity: 2,
    unit_price: 100, subtotal: 200, selected_options: [] }],
};

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/shop");
  api.me.mockResolvedValue({ id: "tester", email: "tester@example.test", display_name: "測試人員" });
  api.catalog.mockResolvedValue([{ id: "goods", name: "商品", activity_id: "festival",
    sort_order: 0, products: [testingProduct, formalProduct], series: [] }]);
  api.getCurrentRegistrations.mockResolvedValue([formalOrder]);
  api.listAvailablePromotions.mockResolvedValue([]);
  api.getProduct.mockImplementation((id: string) => Promise.resolve({
    ...(id === "testing" ? testingProduct : formalProduct), variant_groups: [], media: [],
  }));
});

it("lets an authorized tester order before launch and preserves the formal registration in the same activity", async () => {
  api.setCurrentRegistrationProduct.mockResolvedValue({ ...formalOrder, id: "test-order",
    test_product_id: "testing", total_price: 100, subtotal_price: 100,
    items: [{ ...formalOrder.items[0], id: "test-item", product_id: "testing", product_name: "測試限定商品", quantity: 1, subtotal: 100 }],
  });
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：測試限定商品" }));
  expect(await screen.findByText(/測試中：正式開放時會清除/)).toBeVisible();
  const register = await screen.findByRole("button", { name: "登記購買 · NT$100" });
  await waitFor(() => expect(register).toBeEnabled());
  fireEvent.click(register);
  await waitFor(() => expect(api.setCurrentRegistrationProduct).toHaveBeenCalledWith(
    "testing", { variants: [{ option_ids: [], quantity: 1 }] },
  ));
  expect(await screen.findByRole("button", { name: "移除這項登記" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  fireEvent.click(screen.getByRole("link", { name: "查看商品：正式商品" }));
  expect(await screen.findByRole("button", { name: "完成" })).toBeVisible();
  expect(screen.getByRole("button", { name: "移除這項登記" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  fireEvent.click(screen.getByRole("link", { name: "查看商品：測試限定商品" }));
  expect(await screen.findByRole("button", { name: "移除這項登記" })).toBeEnabled();
});

it("keeps a saved activity promotion out of a product route for another activity", async () => {
  const christmasProduct = { ...formalProduct, id: "christmas-card", name: "聖誕卡片" };
  const christmasSnack = { ...formalProduct, id: "christmas-snack", name: "聖誕點心" };
  const festivalProduct = { ...formalProduct, id: "festival-shirt", name: "校慶衣服" };
  const festivalSnack = { ...formalProduct, id: "festival-drink", name: "校慶飲料" };
  window.localStorage.setItem("hcca:pref:shop:category:v1", JSON.stringify("christmas"));
  api.catalog.mockResolvedValue([
    { id: "christmas", name: "聖誕傳情", activity_id: "christmas", activity_name: "聖誕傳情",
      sort_order: 0, products: [christmasProduct, christmasSnack], series: [] },
    { id: "festival", name: "校慶商品", activity_id: "festival", activity_name: "校慶",
      sort_order: 1, products: [festivalProduct, festivalSnack], series: [] },
  ]);
  api.listAvailablePromotions.mockResolvedValue([
    { id: "christmas-bundle", name: "聖誕傳情套組", activity_id: "christmas",
      discount_type: "bundle_price", discount_value: 150, min_order_price: 0, min_quantity: 1,
      target_products: [christmasProduct, christmasSnack] },
    { id: "festival-bundle", name: "校慶優惠套組", activity_id: "festival",
      discount_type: "bundle_price", discount_value: 150, min_order_price: 0, min_quantity: 1,
      target_products: [festivalProduct, festivalSnack] },
  ]);

  render(<ShopPage topicSlug="校慶商品" productSlug="校慶衣服" />);

  await screen.findByRole("heading", { name: "校慶商品", level: 2 });
  expect(screen.queryByRole("region", { name: "一起買更划算" })).toBeInTheDocument();
  expect(screen.queryByRole("article", { name: "聖誕傳情套組" })).not.toBeInTheDocument();
  expect(await screen.findByRole("article", { name: "校慶優惠套組" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "選購套組：聖誕傳情套組" })).not.toBeInTheDocument();
});

it("keeps unscoped bundle offers with another category's products out of the selected activity", async () => {
  const christmasProduct = { ...formalProduct, id: "christmas-card", name: "聖誕卡片" };
  const christmasSnack = { ...formalProduct, id: "christmas-snack", name: "聖誕點心" };
  const festivalProduct = { ...formalProduct, id: "festival-shirt", name: "校慶衣服" };
  const festivalSnack = { ...formalProduct, id: "festival-drink", name: "校慶飲料" };
  api.catalog.mockResolvedValue([
    { id: "christmas", name: "聖誕傳情", sort_order: 0,
      products: [christmasProduct, christmasSnack], series: [] },
    { id: "festival", name: "校慶商品", sort_order: 1,
      products: [festivalProduct, festivalSnack], series: [] },
  ]);
  api.listAvailablePromotions.mockResolvedValue([
    { id: "christmas-bundle", name: "聖誕傳情套組", activity_id: null,
      discount_type: "bundle_price", discount_value: 150, min_order_price: 0, min_quantity: 1,
      target_products: [christmasProduct, christmasSnack] },
    { id: "festival-bundle", name: "校慶優惠套組", activity_id: null,
      discount_type: "bundle_price", discount_value: 150, min_order_price: 0, min_quantity: 1,
      target_products: [festivalProduct, festivalSnack] },
  ]);

  render(<ShopPage />);

  await screen.findByRole("heading", { name: "聖誕傳情", level: 2 });
  expect(await screen.findByRole("article", { name: "聖誕傳情套組" })).toBeVisible();
  expect(screen.queryByRole("article", { name: "校慶優惠套組" })).not.toBeInTheDocument();
});
