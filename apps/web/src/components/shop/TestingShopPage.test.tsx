import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ShopPage from "@/app/(protected)/shop/page";
import type { OrderOut } from "@/lib/types";

const api = vi.hoisted(() => ({
  me: vi.fn(), catalog: vi.fn(), getCurrentRegistrations: vi.fn(), listAvailablePromotions: vi.fn(),
  getProduct: vi.fn(), getCloseStatus: vi.fn(), myClass: vi.fn(), setCurrentRegistrationProduct: vi.fn(),
  previewCurrentPromotion: vi.fn(), applyCurrentPromotion: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  authApi: { refresh: api.me }, shopApi: api,
  classApi: { myClass: api.myClass },
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

afterEach(() => { vi.unstubAllGlobals(); });

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/shop");
  api.me.mockResolvedValue({ id: "tester", email: "tester@example.test", display_name: "測試人員" });
  api.catalog.mockResolvedValue([{ id: "goods", name: "商品", activity_id: "festival",
    sort_order: 0, products: [testingProduct, formalProduct], series: [] }]);
  api.getCloseStatus.mockResolvedValue({ statuses: {} });
  api.myClass.mockResolvedValue(null);
  api.getCurrentRegistrations.mockResolvedValue([formalOrder]);
  api.previewCurrentPromotion.mockResolvedValue({ eligible: false, reason_code: "no_promotion",
    subtotal_price: 200, discount_amount: 0, total_price: 200, shortfall: 0, quantity_shortfall: 0 });
  api.listAvailablePromotions.mockResolvedValue([]);
  api.getProduct.mockImplementation((id: string) => Promise.resolve({
    ...(id === "testing" ? testingProduct : formalProduct), variant_groups: [], media: [],
  }));
});

it("refreshes the latest automatic promotion on an existing registration", async () => {
  const discountedOrder: OrderOut = {
    ...formalOrder, promotion_id: "cadre-promotion", discount_amount: 40, total_price: 160,
    applied_promotions: [{ promotion_id: "cadre-promotion", name: "幹部優惠", code: null, discount_amount: 40 }],
  };
  api.previewCurrentPromotion.mockResolvedValue({ eligible: true, reason_code: "applied",
    promotion_name: "幹部優惠", promotion_code: null, subtotal_price: 200,
    discount_amount: 40, total_price: 160, shortfall: 0, quantity_shortfall: 0 });
  api.applyCurrentPromotion.mockResolvedValue(discountedOrder);

  render(<ShopPage />);

  expect(await screen.findByText(/共省 NT\$40/)).toBeVisible();
  expect(api.previewCurrentPromotion).toHaveBeenCalledWith(null, "festival", null);
  expect(api.applyCurrentPromotion).toHaveBeenCalledWith(null, "festival", null);
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

it("shows a shared deadline once and keeps a product's extended deadline visible", async () => {
  api.catalog.mockResolvedValue([{ id: "goods", name: "校慶預購", activity_id: "festival",
    sort_order: 0, order_closes_at: "2099-10-31T00:00:00Z", series: [], products: [
      { ...formalProduct, sale_end: "2099-10-31T00:00:00Z" },
      { ...formalProduct, id: "extended", name: "延長預購商品", sale_end: "2099-11-02T00:00:00Z" },
    ] }]);
  render(<ShopPage />);

  await screen.findByRole("heading", { name: "校慶預購" });
  expect(screen.queryByRole("navigation", { name: "選擇商品活動" })).not.toBeInTheDocument();
  expect(screen.getByText(/活動結單：/)).toBeVisible();
  expect(within(screen.getByRole("article", { name: "正式商品商品" })).queryByText(/^截止/)).not.toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "延長預購商品商品" })).getByText(/^截止/)).toBeVisible();
});

it("shows old links to globally closed products as closed details with both collection times", async () => {
  const closedProduct = { ...formalProduct, id: "closed-product", name: "結單商品" };
  const closedCategory = {
    id: "closed-category",
    name: "已結單活動",
    activity_id: "closed-activity",
    activity_name: "已結單活動",
    order_closed_at: "2026-10-20T10:00:00Z",
    order_closes_at: null,
    sort_order: 0,
    products: [closedProduct],
    series: [],
  };
  api.catalog.mockResolvedValue([closedCategory]);
  api.myClass.mockResolvedValue({ id: "class-1", label: "一年一班" });
  api.getCloseStatus.mockResolvedValue({ statuses: {
    "closed-category": {
      is_closed: true,
      is_global: true,
      closed_at: "2026-10-20T10:00:00Z",
      class_collected_at: "2026-10-21T10:00:00Z",
      council_confirmed_at: "2026-10-22T10:00:00Z",
    },
  } });
  api.getProduct.mockResolvedValue({ ...closedProduct, variant_groups: [], media: [] });

  render(<ShopPage productSlug={encodeURIComponent("結單商品")} />);

  const dialog = await screen.findByRole("dialog");
  expect(api.catalog).toHaveBeenCalledWith(undefined, false, ["結單商品"]);
  expect(within(dialog).getByRole("heading", { name: "班聯已結單" })).toBeVisible();
  expect(within(dialog).getByText(/商品已從公開目錄隱藏/)).toBeVisible();
  expect(within(dialog).getByText("班代收款時間")).toBeVisible();
  expect(within(dialog).getByText("班聯確認時間")).toBeVisible();
  expect(within(dialog).getByText(/2026.*10.*21/)).toBeVisible();
  expect(within(dialog).getByText(/2026.*10.*22/)).toBeVisible();
  expect(screen.queryByRole("navigation", { name: "選擇商品活動" })).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "班聯已結單" })).toBeDisabled();
  expect(within(dialog).queryByRole("link", { name: "登入後登記商品" })).not.toBeInTheDocument();
  expect(within(dialog).getByText("班聯已結單，此活動商品已停止訂購")).toBeVisible();
  expect(within(dialog).queryByText(/代訂需要學生授權/)).not.toBeInTheDocument();
});

it("hides closed activities from the public catalog and shows an empty state", async () => {
  api.catalog.mockResolvedValue([{
    id: "closed-category",
    name: "已結單活動",
    activity_id: "closed-activity",
    order_closed_at: "2026-10-20T10:00:00Z",
    order_closes_at: null,
    sort_order: 0,
    products: [{ ...formalProduct, id: "closed-product", name: "結單商品" }],
    series: [],
  }]);

  render(<ShopPage />);

  expect(await screen.findByText("目前沒有可訂購的商品，請稍後再來看看。")).toBeVisible();
  expect(screen.queryByText("結單商品")).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "選擇商品活動" })).not.toBeInTheDocument();
});

it.each(["activity", "deadline", "global", "class-paid"] as const)(
  "hides an activity closed by %s without closure or payment notices",
  async (reason) => {
    window.history.replaceState({}, "", "/shop?product=closed-product");
    window.localStorage.setItem("hcca:pref:shop:category:v1", JSON.stringify("closed-category"));
    api.myClass.mockResolvedValue({ id: "class-1", label: "一年一班" });
    api.catalog.mockResolvedValue([
      { id: "closed-category", name: "已結單活動", sort_order: 0, series: [],
        order_closed_at: reason === "activity" ? "2026-10-20T10:00:00Z" : null,
        order_closes_at: reason === "deadline" ? "2026-10-20T10:00:00Z" : null,
        products: [{ ...formalProduct, id: "closed-product", name: "結單商品" }] },
      { id: "winter", name: "冬季預購", sort_order: 1, series: [],
        products: [{ ...formalProduct, id: "winter-product", name: "冬季商品" }] },
    ]);
    api.getCloseStatus.mockResolvedValue({ statuses: {
      "closed-category": { is_closed: true, is_global: reason !== "class-paid" },
      winter: { is_closed: false },
    } });

    render(<ShopPage />);

    expect(await screen.findByRole("link", { name: "查看商品：冬季商品" })).toBeVisible();
    expect(screen.queryByText("已結單活動")).not.toBeInTheDocument();
    expect(screen.queryByText("結單商品")).not.toBeInTheDocument();
    expect(screen.queryByText("部分活動已結單")).not.toBeInTheDocument();
    expect(screen.queryByText("班聯已確認本班收款")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "活動結單通知" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "選擇商品活動" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "我的班級" })).not.toHaveAttribute("data-closed");
  },
);

it("shows the empty catalog without notices when the class has paid for every activity", async () => {
  api.myClass.mockResolvedValue({ id: "class-1", label: "一年一班" });
  api.getCloseStatus.mockResolvedValue({ statuses: {
    goods: { is_closed: true, is_global: false },
  } });

  render(<ShopPage />);

  expect(await screen.findByText("目前沒有可訂購的商品，請稍後再來看看。")).toBeVisible();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  expect(screen.queryByText("部分活動已結單")).not.toBeInTheDocument();
  expect(screen.queryByText("班聯已確認本班收款")).not.toBeInTheDocument();
  expect(screen.getByRole("group", { name: "我的班級" })).not.toHaveAttribute("data-closed");
});

it("ignores closure statuses for activities absent from the catalog", async () => {
  api.myClass.mockResolvedValue({ id: "class-1", label: "一年一班" });
  api.getCloseStatus.mockResolvedValue({ statuses: {
    "hidden-category": { is_closed: true, is_global: true },
  } });

  render(<ShopPage />);

  expect(await screen.findByRole("link", { name: "查看商品：正式商品" })).toBeVisible();
  expect(screen.queryByText("部分活動已結單")).not.toBeInTheDocument();
  expect(screen.getByRole("group", { name: "我的班級" })).not.toHaveAttribute("data-closed");
});

it("keeps multiple activities switchable in the compact catalog", async () => {
  api.catalog.mockResolvedValue([
    { id: "goods", name: "校慶預購", sort_order: 0, products: [formalProduct], series: [] },
    { id: "winter", name: "冬季預購", sort_order: 1,
      products: [{ ...formalProduct, id: "winter-product", name: "冬季商品" }], series: [] },
  ]);
  render(<ShopPage />);

  const picker = await screen.findByRole("navigation", { name: "選擇商品活動" });
  fireEvent.click(within(picker).getByRole("button", { name: /冬季預購/ }));
  expect(await screen.findByRole("link", { name: "查看商品：冬季商品" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "查看商品：正式商品" })).not.toBeInTheDocument();
});

it("keeps the purchase action available while product descriptions are collapsed", async () => {
  api.getProduct.mockResolvedValue({ ...testingProduct, description: "衣服尺寸與保養方式", variant_groups: [], media: [] });
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：測試限定商品" }));

  const description = await screen.findByText("衣服尺寸與保養方式");
  expect(description.closest("details")).not.toHaveAttribute("open");
  expect(await screen.findByRole("button", { name: "登記購買 · NT$100" })).toBeVisible();
  fireEvent.click(screen.getByText("商品說明"));
  expect(description).toBeVisible();
});

it("opens products in place while retaining links for a separate tab", async () => {
  render(<ShopPage />);
  const product = await screen.findByRole("link", { name: "查看商品：測試限定商品" });
  expect(product.getAttribute("href")).toMatch(/^\/shop\//);
  fireEvent.click(product, { ctrlKey: true });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(product);
  expect(await screen.findByRole("dialog")).toBeVisible();
  expect(window.location.pathname).toBe("/shop");
});

it("submits a Christmas card without options and shows failure and success beside the action", async () => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  const card = { ...formalProduct, id: "card", name: "卡片", price: 40,
    is_unlimited: true, stock_quantity: 0 };
  api.me.mockResolvedValue({ id: "student", student_id: "synthetic", display_name: "測試學生" });
  api.catalog.mockResolvedValue([{ id: "christmas", name: "聖誕傳情", activity_id: null,
    sort_order: 0, products: [card], series: [] }]);
  api.getCurrentRegistrations.mockResolvedValue([]);
  api.getProduct.mockResolvedValue({ ...card, variant_groups: [], media: [] });
  let rejectSave!: (error: Error) => void;
  api.setCurrentRegistrationProduct.mockImplementationOnce(() => new Promise((_, reject) => {
    rejectSave = reject;
  }));
  const saved: OrderOut = { ...formalOrder, activity_id: null, category_id: "christmas", total_price: 40, subtotal_price: 40, items: [
    { ...formalOrder.items[0], product_id: "card", product_name: "卡片", quantity: 1,
      unit_price: 40, subtotal: 40 },
  ] };
  api.setCurrentRegistrationProduct.mockResolvedValue(saved);
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：卡片" }));

  const dialog = within(await screen.findByRole("dialog"));
  const purchase = await dialog.findByRole("button", { name: "登記購買 · NT$40" });
  await waitFor(() => expect(purchase).toBeEnabled());
  fireEvent.click(purchase);
  expect(dialog.getByRole("button", { name: "處理中…" })).toBeDisabled();
  expect(dialog.getByRole("status")).toHaveTextContent("正在更新登記數量…");
  await act(async () => { rejectSave(new Error("庫存不足，請調整數量。")); });

  expect(await dialog.findByRole("alert")).toHaveTextContent("庫存不足，請調整數量。");
  expect(dialog.queryByText(/已登記/)).not.toBeInTheDocument();
  fireEvent.click(dialog.getByRole("button", { name: "登記購買 · NT$40" }));
  expect(await dialog.findByRole("button", { name: "完成" })).toBeEnabled();
  expect(dialog.getByRole("status")).toHaveTextContent("已登記 1 件。");
  expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
  expect(api.setCurrentRegistrationProduct).toHaveBeenCalledTimes(2);
  expect(api.setCurrentRegistrationProduct).toHaveBeenLastCalledWith("card", {
    variants: [{ option_ids: [], quantity: 1 }],
  });
});
