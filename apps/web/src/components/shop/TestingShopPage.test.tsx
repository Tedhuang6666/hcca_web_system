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
const catalogCache = vi.hoisted(() => ({ get: vi.fn(), has: vi.fn(), set: vi.fn() }));
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
vi.mock("@/lib/api-cache", () => ({ cacheGet: catalogCache.get, cacheHas: catalogCache.has, cacheSet: catalogCache.set }));

const testingProduct = {
  id: "testing", name: "測試限定商品", price: 100, image_url: null, status: "testing" as const,
  is_unlimited: false, stock_quantity: 4, has_variants: false, has_option_surcharge: false, requires_seating: false,
  sale_start: "2099-01-01T00:00:00Z", sale_end: null,
};
const formalProduct = { ...testingProduct, id: "formal", name: "正式商品", status: "active" as const, sale_start: null };

it("商品詳情的尺寸表隨尺寸按鈕切換標示", async () => {
  api.getProduct.mockResolvedValue({ ...formalProduct, media: [], variant_groups: [{
    id: "size", name: "尺寸", options: ["M", "L"].map((value) => ({ id: value, value, is_active: true, price_delta: 0 })),
  }], size_chart: { group_id: "size", columns: ["衣長（cm）"], rows: [
    { option_id: "M", values: ["68"] }, { option_id: "L", values: ["72"] },
  ] } });
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：正式商品" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click((await within(dialog).findAllByRole("button", { name: "M" }))[0]);
  expect(within(dialog).getByRole("row", { name: "M 已選 68" })).toHaveAttribute("data-selected", "true");
  fireEvent.click(within(dialog).getAllByRole("button", { name: "L" })[1]);
  expect(within(dialog).getByRole("row", { name: "M 68" })).toHaveAttribute("data-selected", "false");
  expect(within(dialog).getByRole("row", { name: "L 已選 72" })).toHaveAttribute("data-selected", "true");
});

const formalOrder: OrderOut = {
  id: "formal-order", user_id: "tester", activity_id: "festival", status: "pending",
  serial_number: "FORMAL-001", created_at: "2026-10-22T00:00:00Z", updated_at: "2026-10-22T00:00:00Z",
  assistance_scope: "self", payment_method: "cash_on_pickup",
  total_price: 200, subtotal_price: 200, discount_amount: 0, is_paid: false, is_class_collected: false,
  items: [{ gift_quantity: 0, gift_discount_amount: 0, id: "formal-item", product_id: "formal", product_name: "正式商品", quantity: 2,
    unit_price: 100, subtotal: 200, selected_options: [] }],
};

it("優惠很多時先選規格，優惠收合且不影響登記購買", async () => {
  api.me.mockResolvedValue({ id: "tester", student_id: "310001" });
  api.getCurrentRegistrations.mockResolvedValue([]);
  api.listAvailablePromotions.mockResolvedValue(Array.from({ length: 12 }, (_, index) => ({ gift_quantity: 1,
    id: `sale-${index}`, name: `滿額優惠 ${index + 1}`, activity_id: "festival",
    discount_type: "fixed", discount_value: 10, min_order_price: 1000, min_quantity: 1,
    target_products: [{ id: "formal", name: "正式商品" }],
  })));
  api.getProduct.mockResolvedValue({ ...formalProduct, media: [], variant_groups: [{
    id: "size", name: "尺寸", options: [{ id: "M", value: "M", is_active: true, price_delta: 0 }],
  }] });
  api.setCurrentRegistrationProduct.mockResolvedValue(formalOrder);
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：正式商品" }));
  const dialog = await screen.findByRole("dialog");
  const option = await within(dialog).findByRole("button", { name: "M" });
  const offers = await within(dialog).findByRole("region", { name: "優惠與贈品" });
  expect(within(offers).getByText("共 12 項")).toBeVisible();
  expect(within(offers).getByText("滿額優惠 12")).not.toBeVisible();
  expect(option.compareDocumentPosition(offers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(option);
  const submit = within(dialog).getByRole("button", { name: "登記購買 · NT$100" });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await waitFor(() => expect(api.setCurrentRegistrationProduct).toHaveBeenCalledWith("formal", {
    variants: [{ option_ids: ["M"], quantity: 1 }],
  }));
});

it("一般商品可直接替換指定尺寸並一次儲存數量，其他規格保留", async () => {
  const option = (id: string) => ({ group_id: "size", group_name: "尺寸", option_id: id, value: id, price_delta: 0 });
  const original: OrderOut = { ...formalOrder, items: [
    { ...formalOrder.items[0], selected_options: [option("M")] },
    { ...formalOrder.items[0], id: "xl", quantity: 1, subtotal: 100, selected_options: [option("XL")] },
  ] };
  const changed: OrderOut = { ...original, items: [original.items[1],
    { ...original.items[0], selected_options: [option("L")], quantity: 3, subtotal: 300 }] };
  api.me.mockResolvedValue({ id: "tester", student_id: "310001" });
  api.getCurrentRegistrations.mockResolvedValue([original]);
  api.getProduct.mockResolvedValue({ ...formalProduct, variant_groups: [{ id: "size", name: "尺寸",
    options: ["M", "L", "XL"].map((id) => ({ id, value: id, is_active: true, price_delta: 0 })) }], media: [] });
  api.setCurrentRegistrationProduct.mockRejectedValueOnce(new Error("更新失敗，請重試"))
    .mockResolvedValueOnce(changed);
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：正式商品" }));
  const variants = await screen.findByRole("region", { name: "已登記的規格" });
  const row = within(variants).getByText("M × 2").closest("li")!;
  fireEvent.click(within(row).getByRole("button", { name: "修改尺寸／規格與數量" }));
  fireEvent.click(screen.getByRole("button", { name: "L" }));
  fireEvent.click(screen.getByRole("button", { name: "增加數量" }));
  expect(api.setCurrentRegistrationProduct).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "儲存修改" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("更新失敗，請重試");
  expect(within(variants).getByText("M × 2")).toBeVisible();
  expect(screen.getByRole("button", { name: "L" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "儲存修改" }));
  await waitFor(() => expect(api.setCurrentRegistrationProduct).toHaveBeenLastCalledWith("formal", {
    variants: [{ option_ids: ["XL"], quantity: 1 }, { option_ids: ["L"], quantity: 3 }],
  }));
  expect(await within(variants).findByText("L × 3")).toBeVisible();
  expect(within(variants).getByText("XL × 1")).toBeVisible();
  expect(within(variants).queryByText("M × 2")).not.toBeInTheDocument();
});

it("商品詳情逐筆列出同筆登記已套用的自動優惠與優惠碼", async () => {
  api.getCurrentRegistrations.mockResolvedValue([{ ...formalOrder, promotion_code: "SAVE",
    discount_amount: 30, total_price: 170, applied_promotions: [
      { promotion_id: "auto", name: "校慶優惠", discount_amount: 20 },
      { promotion_id: "coupon", name: "迎新折價券", code: "SAVE", discount_amount: 10 },
    ],
  }]);
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：正式商品" }));
  const section = await screen.findByRole("region", { name: "優惠與贈品" });
  fireEvent.click(within(section).getByText("優惠與贈品"));
  expect(await within(section).findByRole("listitem", { name: "校慶優惠" })).toHaveTextContent("本筆登記折抵 NT$20");
  expect(within(section).getByRole("listitem", { name: "迎新折價券" })).toHaveTextContent("本筆登記折抵 NT$10");
});

it("登記贈品後，商品詳情由尚未登記更新為已套用贈品優惠", async () => {
  api.me.mockResolvedValue({ id: "tester", student_id: "310001", email: "tester@example.test" });
  api.getCurrentRegistrations.mockResolvedValue([]);
  api.listAvailablePromotions.mockResolvedValue([{ gift_quantity: 1,
    id: "gift", name: "抽獎贈品", activity_id: "festival", discount_type: "percentage", discount_value: 100,
    min_order_price: 0, min_quantity: 1, target_products: [{ id: "formal", name: "正式商品" }],
  }]);
  api.setCurrentRegistrationProduct.mockResolvedValue({ ...formalOrder, subtotal_price: 100, total_price: 0,
    discount_amount: 100, promotion_id: "gift", applied_promotions: [{ promotion_id: "gift", name: "抽獎贈品", discount_amount: 100 }],
    items: [{ ...formalOrder.items[0], quantity: 1, subtotal: 100 }],
  });
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：正式商品" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByText("優惠與贈品"));
  expect(await within(dialog).findByText("贈品：正式商品")).toBeVisible();
  expect(within(dialog).getByText("尚未登記贈品")).toBeVisible();
  const submit = await within(dialog).findByRole("button", { name: "登記購買 · NT$0" });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  expect(await within(dialog).findByText("已登記 1 件，已套用贈品優惠")).toBeVisible();
  expect(api.setCurrentRegistrationProduct).toHaveBeenCalledWith("formal", { variants: [{ option_ids: [], quantity: 1 }] });
});

afterEach(() => { vi.unstubAllGlobals(); });

it.each(["棉T", "刷毛帽T", "風衣外套"])("%s 使用後台主圖與圖集，不自動加入模特兒照", async (name) => {
  const product = { ...formalProduct, name, image_url: "/front.png" };
  api.catalog.mockResolvedValue([{ id: "goods", name: "104 校慶商品", activity_id: "festival",
    sort_order: 0, products: [product], series: [] }]);
  api.getProduct.mockResolvedValue({ ...product, variant_groups: [], media: [
    { id: "front", image_url: "/front.png", label: "正面", kind: "product" },
    { id: "back", image_url: "/back.png", label: "背面", kind: "product" },
  ] });

  render(<ShopPage />);
  const card = await screen.findByRole("link", { name: `查看商品：${name}` });
  expect(await within(card).findByRole("img", { name })).toHaveAttribute("src", expect.stringContaining("/front.png"));
  expect(screen.queryByRole("heading", { name: "把校園，穿進日常。" })).not.toBeInTheDocument();

  fireEvent.click(card);
  expect(await screen.findByRole("img", { name: `${name}・正面` })).toBeVisible();
  expect(screen.getByLabelText("第 1 張，共 2 張")).toBeVisible();
  expect(screen.queryByRole("button", { name: /顯示模特兒宣傳照/ })).not.toBeInTheDocument();
  expect(document.querySelector('img[src*="/shop/104/"], img[srcset*="/shop/104/"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "下一張商品圖片" }));
  expect(screen.getByRole("img", { name: `${name}・背面` })).toBeVisible();
});

it("未上傳照片的服飾不產生虛構圖片", async () => {
  api.catalog.mockResolvedValue([{ id: "goods", name: "104 校慶商品", activity_id: "festival",
    sort_order: 0, products: [{ ...formalProduct, name: "棉T" }], series: [] }]);
  render(<ShopPage />);
  const card = await screen.findByRole("link", { name: "查看商品：棉T" });
  expect(within(card).queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "把校園，穿進日常。" })).not.toBeInTheDocument();
});

it("商品圖集可用前後按鈕與鍵盤切換，顯示張數且不超出首尾", async () => {
  api.getProduct.mockResolvedValue({ ...formalProduct, image_url: "/front.png", variant_groups: [],
    media: [
      { id: "front", image_url: "/front.png", label: "正面", kind: "product" },
      { id: "back", image_url: "/back.png", label: "背面", kind: "product" },
      { id: "detail", image_url: "/detail.png", label: "細節", kind: "product" },
    ] });
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：正式商品" }));
  expect(await screen.findByRole("button", { name: "上一張商品圖片" })).toBeDisabled();
  expect(screen.getByLabelText("第 1 張，共 3 張")).toHaveTextContent("1 / 3");
  fireEvent.click(screen.getByRole("button", { name: "下一張商品圖片" }));
  expect(screen.getByRole("img", { name: "正式商品・背面" })).toBeVisible();
  const gallery = screen.getByRole("group", { name: "商品圖片" });
  fireEvent.keyDown(gallery, { key: "End" });
  expect(screen.getByRole("button", { name: "顯示細節" })).toHaveFocus();
  expect(screen.getByRole("button", { name: "下一張商品圖片" })).toBeDisabled();
  expect(screen.getByLabelText("第 3 張，共 3 張")).toBeVisible();
  fireEvent.keyDown(gallery, { key: "ArrowLeft" });
  expect(screen.getByRole("button", { name: "顯示背面" })).toHaveFocus();
  expect(screen.getByRole("button", { name: "顯示背面" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(gallery, { key: "Home" });
  fireEvent.keyDown(gallery, { key: "ArrowLeft" });
  expect(screen.getByRole("button", { name: "顯示正面" })).toHaveFocus();
  expect(screen.getByLabelText("第 1 張，共 3 張")).toBeVisible();
  fireEvent.keyDown(gallery, { key: "ArrowRight" });
  fireEvent.click(screen.getByRole("button", { name: "上一張商品圖片" }));
  expect(screen.getByRole("img", { name: "正式商品・正面" })).toBeVisible();
});

it("單張圖片省略切換列，圖片失敗可重試且不影響購買", async () => {
  api.me.mockResolvedValue({ id: "tester", email: "tester@example.test", can_create_shop_delegation: true });
  api.getProduct.mockResolvedValue({ ...formalProduct, image_url: "/front.png", variant_groups: [], media: [] });
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：正式商品" }));
  const image = await screen.findByRole("img", { name: "正式商品・商品主圖" });
  expect(screen.queryByRole("group", { name: "商品圖片" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "下一張商品圖片" })).not.toBeInTheDocument();
  fireEvent.error(image);
  expect(screen.getByText("圖片暫時無法顯示")).toBeVisible();
  expect(screen.getByRole("button", { name: "增加數量" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "重新載入圖片" }));
  expect(screen.getByRole("img", { name: "正式商品・商品主圖" })).toHaveAttribute("src", expect.stringContaining("/front.png"));
  expect(screen.queryByText("圖片暫時無法顯示")).not.toBeInTheDocument();
});

it("圖片標註可快捷切換，多組規格以最後點選的圖片為準", async () => {
  api.getProduct.mockResolvedValue({ ...formalProduct, name: "正式商品", image_url: "/front.png",
    media: [
      { id: "front", image_url: "/front.png", label: "正面", kind: "product" },
      { id: "back", image_url: "/back.png", label: "背面", kind: "product" },
    ],
    variant_groups: [
      { id: "ticket", name: "門票", options: [
        { id: "badge", value: "徽章", price_delta: 50, is_active: true, image_url: "/badge.png" },
        { id: "plain", value: "不加購", price_delta: 0, is_active: true, image_url: null },
      ] },
      { id: "color", name: "顏色", options: [
        { id: "blue", value: "藍色", price_delta: 0, is_active: true, image_url: "/blue.png" },
      ] },
    ],
  });
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：正式商品" }));
  const front = await screen.findByRole("button", { name: "顯示正面" });
  expect(screen.getByRole("img", { name: "正式商品・正面" })).toHaveAttribute("src", expect.stringContaining("/front.png"));
  expect(screen.getAllByRole("button", { name: "顯示正面" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "顯示背面" }));
  expect(screen.getByRole("img", { name: "正式商品・背面" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /^藍色/ }));
  expect(screen.getByRole("img", { name: "正式商品・藍色" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /徽章.*\+NT\$50/ }));
  expect(screen.getByRole("img", { name: "正式商品・徽章" })).toHaveAttribute("src", expect.stringContaining("/badge.png"));
  expect(screen.getByRole("button", { name: "顯示徽章" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "不加購" }));
  expect(screen.getByRole("img", { name: "正式商品・徽章" })).toBeVisible();
  front.focus();
  fireEvent.click(front);
  expect(front).toHaveFocus();
  expect(front).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("img", { name: "正式商品・正面" })).toBeVisible();
});

it("沒有標註的舊照片仍有可辨識的切換名稱", async () => {
  api.getProduct.mockResolvedValue({ ...formalProduct, image_url: "/old.png", variant_groups: [],
    media: [{ id: "model", image_url: "/model.png", kind: "model" }] });
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：正式商品" }));
  expect(await screen.findByRole("button", { name: "顯示商品主圖" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "顯示模特兒宣傳照 1" }));
  expect(screen.getByRole("img", { name: "正式商品・模特兒宣傳照 1" })).toBeVisible();
});

it.each([undefined, null, "", " \t "])("單張圖片未填描述時不顯示說明列（%s）", async (label) => {
  api.getProduct.mockResolvedValue({ ...formalProduct, image_url: "/front.png", variant_groups: [],
    media: [{ id: "front", image_url: "/front.png", label, kind: "product" }] });
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：正式商品" }));
  const image = await screen.findByRole("img", { name: "正式商品・商品照片 1" });
  expect(image).toBeVisible();
  expect(image.closest(".shop-product-dialog-media")?.querySelector(".shop-product-dialog-caption"))
    .toBeNull();
});

it("多張圖片只顯示已填寫的描述，空白描述保留張數與切換名稱", async () => {
  api.getProduct.mockResolvedValue({ ...formalProduct, image_url: "/front.png", variant_groups: [],
    media: [
      { id: "front", image_url: "/front.png", label: null, kind: "product" },
      { id: "back", image_url: "/back.png", label: " 背面細節 ", kind: "product" },
      { id: "model", image_url: "/model.png", label: " \t ", kind: "model" },
    ] });
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：正式商品" }));
  const counter = await screen.findByLabelText("第 1 張，共 3 張");
  expect(counter.parentElement).toHaveTextContent(/^1 \/ 3$/);
  expect(screen.getByRole("button", { name: "顯示商品照片 1" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "下一張商品圖片" }));
  expect(screen.getByLabelText("第 2 張，共 3 張").parentElement).toHaveTextContent(/^背面細節2 \/ 3$/);
  fireEvent.click(screen.getByRole("button", { name: "顯示模特兒宣傳照 3" }));
  expect(screen.getByLabelText("第 3 張，共 3 張").parentElement).toHaveTextContent(/^3 \/ 3$/);
  fireEvent.keyDown(screen.getByRole("group", { name: "商品圖片" }), { key: "Home" });
  expect(screen.getByRole("button", { name: "顯示商品照片 1" })).toHaveFocus();
  expect(screen.getByLabelText("第 1 張，共 3 張").parentElement).toHaveTextContent(/^1 \/ 3$/);
});

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

it.each([
  { discount_type: "percentage" as const, discount_value: 10, price: 90 },
  { discount_type: "fixed" as const, discount_value: 20, price: 80 },
  { discount_type: "price_override" as const, discount_value: 0, price: 60 },
])("已有登記時商品卡片與詳情仍顯示 $discount_type 特殊優惠價", async (sale) => {
  const product = { ...formalProduct, original_price: 150 };
  api.catalog.mockResolvedValue([{ id: "goods", name: "商品", activity_id: "festival",
    sort_order: 0, products: [product], series: [] }]);
  api.getProduct.mockResolvedValue({ ...product, variant_groups: [], media: [] });
  api.listAvailablePromotions.mockResolvedValue([{ gift_quantity: 1,
    id: "sale", name: "特殊優惠", activity_id: "festival", code: null,
    discount_type: sale.discount_type, discount_value: sale.discount_value,
    min_quantity: 1, min_order_price: 0, target_products: [{ id: product.id, name: product.name }],
    product_price_overrides: [{ product_id: product.id, product_name: product.name, unit_price: 60 }],
  }]);
  render(<ShopPage />);
  const card = await screen.findByRole("link", { name: "查看商品：正式商品" });
  const priceLabel = `原價 NT$150，優惠價 NT$${sale.price}`;
  await waitFor(() => expect(within(card).getByLabelText(priceLabel)).toBeVisible());
  expect(card.querySelector("del")).toHaveTextContent("NT$150");
  fireEvent.click(card);
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByLabelText(priceLabel)).toBeVisible();
});

it("only shows eligible tickets and removes empty series, themes and related bundle offers", async () => {
  const hidden = { ...formalProduct, id: "restricted", name: "工作人員票", purchase_allowed: false,
    purchase_restriction: "您不符合購買資格" };
  const visible = { ...formalProduct, id: "public", name: "一般預售票", purchase_allowed: true };
  api.catalog.mockResolvedValue([
    { id: "dance", name: "聯合舞會", sort_order: 0, products: [hidden], series: [
      { id: "public-tickets", name: "公開票種", sort_order: 0, products: [visible, hidden] },
      { id: "staff-tickets", name: "工作票種", sort_order: 1, products: [hidden] },
    ] },
    { id: "performers", name: "表演人員專屬", sort_order: 1, products: [hidden], series: [] },
  ]);
  api.listAvailablePromotions.mockResolvedValue([{ gift_quantity: 1, id: "restricted-bundle", name: "限定工作套組",
    discount_type: "bundle_price", discount_value: 100, min_order_price: 0, min_quantity: 1,
    target_products: [visible, hidden] }]);

  render(<ShopPage />);

  expect(await screen.findByRole("link", { name: "查看商品：一般預售票" })).toBeVisible();
  expect(within(screen.getByRole("heading", { name: "聯合舞會", level: 2 }).parentElement!)
    .getByText("1 件商品")).toBeVisible();
  expect(screen.getByRole("link", { name: "查看商品：一般預售票" })).toHaveAttribute("href",
    `/shop/${encodeURIComponent("聯合舞會")}/${encodeURIComponent("一般預售票")}`);
  for (const name of ["工作人員票", "工作票種", "表演人員專屬", "限定工作套組", "您不符合購買資格"]) {
    expect(screen.queryByText(name)).not.toBeInTheDocument();
  }
  expect(screen.queryByRole("navigation", { name: "選擇商品活動" })).not.toBeInTheDocument();
});

it("does not open a restricted ticket through its direct link", async () => {
  api.getCurrentRegistrations.mockResolvedValue([]);
  api.catalog.mockResolvedValue([{ id: "dance", name: "聯合舞會", sort_order: 0, series: [],
    products: [{ ...formalProduct, name: "工作人員票", purchase_allowed: false }] }]);

  render(<ShopPage productSlug="工作人員票" />);

  expect(await screen.findByText("目前沒有可訂購的商品，請稍後再來看看。")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("工作人員票")).not.toBeInTheDocument();
  expect(api.getProduct).not.toHaveBeenCalled();
});

it.each(["product", "group"])("keeps a purchased %s-limited ticket editable and removable", async (limit) => {
  const ticket = { ...formalProduct, max_quantity_per_user: limit === "product" ? 1 : null,
    remaining_quantity_for_user: 0, purchase_group: limit === "group" ? "tickets" : null,
    purchase_allowed: false, purchase_restriction: "同組商品合計限購一件，您已有訂購的票券" };
  const option = (id: string) => ({ group_id: "type", group_name: "票種", option_id: id,
    value: id, price_delta: 0 });
  const original: OrderOut = { ...formalOrder, total_price: 100, subtotal_price: 100,
    items: [{ ...formalOrder.items[0], quantity: 1, subtotal: 100, selected_options: [option("A")] }] };
  const changed: OrderOut = { ...original,
    items: [{ ...original.items[0], selected_options: [option("B")] }] };
  api.me.mockResolvedValue({ id: "tester", student_id: "310001" });
  api.catalog.mockResolvedValue([{ id: "goods", name: "商品", activity_id: "festival",
    sort_order: 0, products: [], series: [
      { id: "tickets", name: "門票", sort_order: 0, products: [ticket] },
    ] }]);
  api.getCurrentRegistrations.mockResolvedValue([original]);
  api.getProduct.mockResolvedValue({ ...ticket, variant_groups: [
    { id: "type", name: "票種", options: ["A", "B"].map((id) => ({
      id, value: id, price_delta: 0, is_active: true,
    })) },
  ], media: [] });
  api.setCurrentRegistrationProduct.mockRejectedValueOnce(new Error("暫時無法更新，請重試"))
    .mockResolvedValueOnce(changed).mockResolvedValueOnce({ ...original, status: "cancelled", items: [] });
  render(<ShopPage />);

  fireEvent.click(await screen.findByRole("link", { name: "查看商品：正式商品" }));
  expect(await screen.findByRole("button", { name: "移除這項登記" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "B" }));
  const update = screen.getByRole("button", { name: "更新選項 · NT$100" });
  expect(update).toBeEnabled();
  fireEvent.click(update);
  expect(await screen.findByRole("alert")).toHaveTextContent("暫時無法更新，請重試");
  expect(screen.getByRole("button", { name: "B" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(update);
  expect(await screen.findByRole("button", { name: "移除這項登記" })).toBeEnabled();
  expect(api.setCurrentRegistrationProduct).toHaveBeenLastCalledWith("formal", {
    variants: [{ option_ids: ["B"], quantity: 1 }],
  });
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  fireEvent.click(screen.getByRole("link", { name: "查看商品：正式商品" }));
  const remove = await screen.findByRole("button", { name: "移除這項登記" });
  expect(screen.getByRole("button", { name: "B" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(remove);
  await waitFor(() => expect(api.setCurrentRegistrationProduct).toHaveBeenLastCalledWith("formal", { variants: [] }));
});

it("keeps a single-purchase product visible when the catalog refreshes after registration", async () => {
  const ticket = { ...formalProduct, max_quantity_per_user: 1, purchase_allowed: true };
  const catalog = (purchaseAllowed: boolean) => [{ id: "goods", name: "商品", activity_id: "festival",
    sort_order: 0, products: [{ ...ticket, purchase_allowed: purchaseAllowed }], series: [] }];
  const registered: OrderOut = { ...formalOrder, total_price: 100, subtotal_price: 100,
    items: [{ ...formalOrder.items[0], quantity: 1, subtotal: 100 }] };
  api.me.mockResolvedValue({ id: "tester", student_id: "310001" });
  api.getCurrentRegistrations.mockResolvedValue([]);
  api.catalog.mockResolvedValue(catalog(true));
  api.getProduct.mockResolvedValue({ ...ticket, variant_groups: [], media: [] });
  api.setCurrentRegistrationProduct.mockResolvedValue(registered);
  render(<ShopPage />);
  fireEvent.click(await screen.findByRole("link", { name: "查看商品：正式商品" }));
  fireEvent.click(await screen.findByRole("button", { name: "登記購買 · NT$100" }));
  expect(await screen.findByRole("button", { name: "移除這項登記" })).toBeEnabled();

  api.catalog.mockResolvedValue(catalog(false));
  api.getCurrentRegistrations.mockResolvedValue([registered]);
  fireEvent.focus(window);
  await waitFor(() => expect(api.catalog).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("link", { name: "查看商品：正式商品" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  fireEvent.click(screen.getByRole("link", { name: "查看商品：正式商品" }));
  expect(await screen.findByRole("button", { name: "移除這項登記" })).toBeEnabled();
});

it("waits for current account eligibility instead of showing another account's cached tickets", async () => {
  const cached = [{ id: "old", name: "上一個帳號的票種", sort_order: 0, series: [],
    products: [{ ...formalProduct, name: "上一個帳號的指定票", purchase_allowed: true }] }];
  catalogCache.get.mockReturnValue(cached);
  catalogCache.has.mockReturnValue(true);
  let authenticate!: (user: { id: string; student_id: string }) => void;
  api.me.mockReturnValue(new Promise((resolve) => { authenticate = resolve; }));
  api.catalog.mockResolvedValue([{ id: "dance", name: "聯合舞會", sort_order: 0, series: [],
    products: [{ ...formalProduct, name: "本人的指定票", purchase_allowed: true }] }]);

  render(<ShopPage />);

  expect(screen.queryByText("上一個帳號的指定票")).not.toBeInTheDocument();
  expect(api.catalog).not.toHaveBeenCalled();
  await act(async () => { authenticate({ id: "current-student", student_id: "310001" }); });
  expect(await screen.findByRole("link", { name: "查看商品：本人的指定票" })).toBeVisible();
  expect(screen.queryByText("上一個帳號的指定票")).not.toBeInTheDocument();
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
    { gift_quantity: 1, id: "christmas-bundle", name: "聖誕傳情套組", activity_id: "christmas",
      discount_type: "bundle_price", discount_value: 150, min_order_price: 0, min_quantity: 1,
      target_products: [christmasProduct, christmasSnack] },
    { gift_quantity: 1, id: "festival-bundle", name: "校慶優惠套組", activity_id: "festival",
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
    { gift_quantity: 1, id: "christmas-bundle", name: "聖誕傳情套組", activity_id: null,
      discount_type: "bundle_price", discount_value: 150, min_order_price: 0, min_quantity: 1,
      target_products: [christmasProduct, christmasSnack] },
    { gift_quantity: 1, id: "festival-bundle", name: "校慶優惠套組", activity_id: null,
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

it.each(["activity", "deadline", "global"] as const)(
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
      "closed-category": { is_closed: true, is_global: true },
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

it("hides a paid class activity and keeps another activity orderable", async () => {
  window.history.replaceState({}, "", "/shop?product=formal");
  window.localStorage.setItem("hcca:pref:shop:category:v1", JSON.stringify("goods"));
  api.me.mockResolvedValue({ id: "tester", display_name: "測試同學", email: "student@example.test", student_id: "student-1" });
  api.myClass.mockResolvedValue({ id: "class-1", label: "一年一班" });
  api.getCurrentRegistrations.mockResolvedValue([]);
  api.getProduct.mockResolvedValue({ ...formalProduct, id: "winter-product", name: "冬季商品",
    variant_groups: [], media: [] });
  api.setCurrentRegistrationProduct.mockResolvedValue(null);
  api.catalog.mockResolvedValue([
    { id: "goods", name: "校慶商品", activity_id: "festival", sort_order: 0,
      products: [formalProduct], series: [] },
    { id: "winter", name: "冬季預購", activity_id: "winter", sort_order: 1,
      products: [{ ...formalProduct, id: "winter-product", name: "冬季商品" }], series: [] },
  ]);
  api.getCloseStatus.mockResolvedValue({ statuses: {
    goods: { is_closed: true, is_global: false, closed_at: "2026-10-30T08:15:03Z",
      council_confirmed_at: "2026-10-30T08:15:03Z" },
    winter: { is_closed: false },
  } });

  render(<ShopPage />);

  const product = await screen.findByRole("link", { name: "查看商品：冬季商品" });
  expect(product).toBeVisible();
  expect(screen.queryByText("校慶商品")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "查看商品：正式商品" })).not.toBeInTheDocument();
  for (const text of ["部分活動已結單", "班聯已確認本班收款", "班代收款時間", "班聯確認時間", "活動結單時間"]) {
    expect(screen.queryByText(text)).not.toBeInTheDocument();
  }
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "選擇商品活動" })).not.toBeInTheDocument();
  expect(screen.queryByText("目前沒有可訂購的商品，請稍後再來看看。")).not.toBeInTheDocument();
  fireEvent.click(product);
  const register = await screen.findByRole("button", { name: "登記購買 · NT$100" });
  await waitFor(() => expect(register).toBeEnabled());
  fireEvent.click(register);
  await waitFor(() => expect(api.setCurrentRegistrationProduct).toHaveBeenCalledWith(
    "winter-product", { variants: [{ option_ids: [], quantity: 1 }] },
  ));
});

it("refreshes an empty locked catalog after payment is revoked while away", async () => {
  api.me.mockResolvedValue({ id: "tester", student_id: "student-1" });
  api.myClass.mockResolvedValue({ id: "class-1", label: "一年一班" });
  api.getCurrentRegistrations.mockResolvedValue([]);
  api.catalog.mockResolvedValue([{ id: "dance", name: "聯合舞會", activity_id: null,
    sort_order: 0, products: [formalProduct], series: [] }]);
  api.getCloseStatus.mockResolvedValueOnce({ statuses: { dance: { is_closed: true } } });
  api.getCloseStatus.mockResolvedValue({ statuses: { dance: { is_closed: false } } });

  render(<ShopPage />);

  expect(await screen.findByText("目前沒有可訂購的商品，請稍後再來看看。")).toBeVisible();
  fireEvent.focus(window);
  const product = await screen.findByRole("link", { name: "查看商品：正式商品" });
  expect(product).toBeVisible();
  expect(api.catalog).toHaveBeenCalledTimes(2);
  fireEvent.click(product);
  await waitFor(() => expect(screen.getByRole("button", { name: "登記購買 · NT$100" })).toBeEnabled());
});

it("refreshes a closed direct link without closing the open product dialog", async () => {
  api.me.mockResolvedValue({ id: "tester", student_id: "student-1" });
  api.myClass.mockResolvedValue({ id: "class-1", label: "一年一班" });
  api.getCurrentRegistrations.mockResolvedValue([]);
  api.catalog.mockResolvedValue([{ id: "goods", name: "校商", activity_id: null,
    sort_order: 0, products: [formalProduct], series: [] }]);
  api.getCloseStatus.mockResolvedValueOnce({ statuses: { goods: { is_closed: true } } });
  api.getCloseStatus.mockResolvedValue({ statuses: { goods: { is_closed: false } } });

  render(<ShopPage productSlug={encodeURIComponent(formalProduct.name)} />);

  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByRole("button", { name: "班聯已確認本班收款" })).toBeDisabled();
  fireEvent.focus(window);
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "登記購買 · NT$100" })).toBeEnabled());
  expect(dialog).toBeVisible();
});

it("shows direct product details while class closure loads, and holds registration until confirmed", async () => {
  api.me.mockResolvedValue({ id: "tester", student_id: "student-1" });
  api.myClass.mockResolvedValue({ id: "class-1", label: "一年一班" });
  api.getCurrentRegistrations.mockResolvedValue([]);
  api.listAvailablePromotions.mockResolvedValue([]);
  api.getProduct.mockResolvedValue({ ...formalProduct, variant_groups: [], media: [] });

  const catalog = [{ id: "goods", name: "校商", activity_id: null,
    sort_order: 0, products: [formalProduct], series: [] }];
  let finishCatalog!: (data: typeof catalog) => void;
  api.catalog.mockImplementation(() => new Promise<typeof catalog>((resolve) => { finishCatalog = resolve; }));

  let finishCloseStatus!: (value: { statuses: Record<string, { is_closed: boolean }> }) => void;
  api.getCloseStatus.mockImplementation(() => new Promise((resolve) => { finishCloseStatus = resolve; }));

  render(<ShopPage productSlug={encodeURIComponent(formalProduct.name)} />);

  await waitFor(() => expect(api.catalog).toHaveBeenCalledTimes(1));
  expect(api.myClass).toHaveBeenCalledTimes(1);
  await act(async () => { finishCatalog(catalog); });

  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByRole("heading", { name: "正式商品" })).toBeVisible();
  expect(api.getCloseStatus).toHaveBeenCalledWith(["goods"], "class-1");
  expect(screen.getByText("正在確認活動結單狀態…")).toBeVisible();
  expect(screen.getByRole("button", { name: "登記購買 · NT$100" })).toBeDisabled();

  await act(async () => { finishCloseStatus({ statuses: { goods: { is_closed: false } } }); });
  await waitFor(() => expect(screen.getByRole("button", { name: "登記購買 · NT$100" })).toBeEnabled());
});

it("keeps the same activity orderable for another class without payment confirmation", async () => {
  api.me.mockResolvedValue({ id: "tester", display_name: "測試同學", email: "student@example.test", student_id: "student-2" });
  api.myClass.mockResolvedValue({ id: "class-2", label: "一年二班" });
  api.getCurrentRegistrations.mockResolvedValue([]);
  api.catalog.mockResolvedValue([{ id: "goods", name: "校慶商品", activity_id: "festival",
    sort_order: 0, products: [formalProduct], series: [] }]);
  api.getCloseStatus.mockResolvedValue({ statuses: { goods: { is_closed: false } } });

  render(<ShopPage />);

  const product = await screen.findByRole("link", { name: "查看商品：正式商品" });
  expect(product).toBeVisible();
  expect(api.getCloseStatus).toHaveBeenCalledWith(["goods"], "class-2");
  fireEvent.click(product);
  const register = await screen.findByRole("button", { name: "登記購買 · NT$100" });
  await waitFor(() => expect(register).toBeEnabled());
});

it("shows an empty catalog without payment notices when the class has paid for its only activity", async () => {
  api.myClass.mockResolvedValue({ id: "class-1", label: "一年一班" });
  api.catalog.mockResolvedValue([{ id: "goods", name: "校慶商品", activity_id: "festival",
    sort_order: 0, products: [], series: [{ id: "shirts", name: "衣服", products: [formalProduct] }] }]);
  api.getCloseStatus.mockResolvedValue({ statuses: {
    goods: { is_closed: true, is_global: false },
  } });

  render(<ShopPage />);

  expect(await screen.findByText("目前沒有可訂購的商品，請稍後再來看看。")).toBeVisible();
  expect(screen.queryByText("部分活動已結單")).not.toBeInTheDocument();
  expect(screen.queryByText("班聯已確認本班收款")).not.toBeInTheDocument();
});

it("does not label class payment confirmation as the activity closure time on a direct link", async () => {
  api.myClass.mockResolvedValue({ id: "class-1", label: "一年一班" });
  api.catalog.mockResolvedValue([{ id: "goods", name: "校慶商品", activity_id: "festival",
    sort_order: 0, products: [formalProduct], series: [] }]);
  api.getCloseStatus.mockResolvedValue({ statuses: {
    goods: { is_closed: true, is_global: false, closed_at: "2026-10-30T08:15:03Z",
      council_confirmed_at: "2026-10-30T08:15:03Z" },
  } });

  render(<ShopPage productSlug={encodeURIComponent(formalProduct.name)} />);

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "班聯已確認本班收款" })).toBeVisible();
  expect(within(dialog).getByText("班聯確認時間")).toBeVisible();
  expect(within(dialog).queryByText("活動結單時間")).not.toBeInTheDocument();
  expect(screen.queryByText("部分活動已結單")).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "班聯已確認本班收款" })).toBeDisabled();
});

it.each(["direct", "series", "route"] as const)("allows authorized testing after class closure (%s)", async (placement) => {
  const inSeries = placement === "series";
  api.myClass.mockResolvedValue({ id: "class-1", label: "一年一班" });
  api.getCloseStatus.mockResolvedValue({ statuses: {
    goods: { is_closed: true, is_global: false },
  } });
  api.catalog.mockResolvedValue([{ id: "goods", name: "商品", activity_id: "festival",
    sort_order: 0, products: inSeries ? [] : [testingProduct], series: inSeries
      ? [{ id: "series", name: "校慶系列", products: [testingProduct] }] : [] }]);
  api.setCurrentRegistrationProduct.mockResolvedValue({ ...formalOrder, id: "test-order",
    test_product_id: "testing", total_price: 100, subtotal_price: 100,
    items: [{ ...formalOrder.items[0], product_id: "testing", product_name: "測試限定商品", quantity: 1, subtotal: 100 }],
  });

  render(<ShopPage productSlug={placement === "route" ? encodeURIComponent(testingProduct.name) : undefined} />);

  fireEvent.click(await screen.findByRole("link", { name: "查看商品：測試限定商品" }));
  expect(screen.queryByRole("region", { name: "活動結單通知" })).not.toBeInTheDocument();
  expect(within(await screen.findByRole("dialog")).queryByRole("heading", {
    name: "班聯已確認本班收款",
  })).not.toBeInTheDocument();
  const register = await screen.findByRole("button", { name: "登記購買 · NT$100" });
  await waitFor(() => expect(register).toBeEnabled());
  fireEvent.click(register);
  await waitFor(() => expect(api.setCurrentRegistrationProduct).toHaveBeenCalledWith(
    "testing", { variants: [{ option_ids: [], quantity: 1 }] },
  ));
});

it("loads the catalog after authentication so testing products are not lost during session refresh", async () => {
  let finishAuthentication!: () => void;
  const authentication = new Promise<void>((resolve) => { finishAuthentication = resolve; });
  let authenticated = false;
  api.me.mockImplementation(async () => {
    await authentication;
    authenticated = true;
    return { id: "tester", display_name: "測試人員", email: "tester@example.test" };
  });
  api.catalog.mockImplementation(async () => authenticated
    ? [{ id: "goods", name: "商品", sort_order: 0, products: [testingProduct], series: [] }]
    : []);

  render(<ShopPage />);

  expect(api.catalog).not.toHaveBeenCalled();
  await act(async () => { finishAuthentication(); });
  expect(await screen.findByRole("link", { name: "查看商品：測試限定商品" })).toBeVisible();
});

it("still loads the public catalog when authentication is unavailable", async () => {
  api.me.mockRejectedValue(new Error("尚未登入"));
  api.catalog.mockResolvedValue([{ id: "goods", name: "商品", sort_order: 0,
    products: [formalProduct], series: [] }]);

  render(<ShopPage />);

  expect(await screen.findByRole("link", { name: "查看商品：正式商品" })).toBeVisible();
  expect(api.myClass).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "查看商品：測試限定商品" })).not.toBeInTheDocument();
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
