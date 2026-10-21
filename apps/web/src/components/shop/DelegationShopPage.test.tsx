import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShopPage from "@/app/(protected)/shop/page";
import type { OrderOut, ShopDelegationContextOut } from "@/lib/types";

const api = vi.hoisted(() => ({
  me: vi.fn(), catalog: vi.fn(), getCurrentRegistrations: vi.fn(), listAvailablePromotions: vi.fn(),
  accessDelegation: vi.fn(), getDelegationProduct: vi.fn(), setDelegationProduct: vi.fn(),
  previewDelegationPromotion: vi.fn(), applyDelegationPromotion: vi.fn(),
  setCurrentRegistrationProduct: vi.fn(), getProduct: vi.fn(), listDelegationLinks: vi.fn(), exchangeDelegationCode: vi.fn(),
  listClassMemberRegistrations: vi.fn(), setClassMemberProduct: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/api", () => ({
  authApi: { me: api.me, refresh: api.me }, shopApi: api, classApi: { myClass: vi.fn().mockResolvedValue(null) },
  apiErrorMessage: (error: Error) => error.message,
}));
vi.mock("@/hooks/useWS", () => ({ useWS: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("@/lib/api-cache", () => ({ cacheGet: () => null, cacheHas: () => false, cacheSet: vi.fn() }));

const product = {
  id: "bag", name: "紀念袋", price: 100, image_url: null, status: "active" as const,
  is_unlimited: true, stock_quantity: 10, has_variants: false, requires_seating: false,
  seating_mode: null, sale_start: null, sale_end: "2099-10-12T00:00:00Z",
};
const order: OrderOut = {
  id: "order", user_id: "student", activity_id: "festival", status: "pending",
  serial_number: "ORDER-001", assistance_scope: "self", payment_method: "school_collection",
  created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-10T00:00:00Z",
  subtotal_price: 500, discount_amount: 0, total_price: 500, is_paid: false, is_class_collected: false,
  promotion_code: null, applied_promotions: [], items: [
    { id: "own", product_id: "bag", product_name: "紀念袋", quantity: 2, unit_price: 100, subtotal: 200, selected_options: [], delegation_link_id: null },
    { id: "mom", product_id: "bag", product_name: "紀念袋", quantity: 1, unit_price: 100, subtotal: 100, selected_options: [], delegation_link_id: "link" },
    { id: "dad", product_id: "bag", product_name: "紀念袋", quantity: 2, unit_price: 100, subtotal: 200, selected_options: [], delegation_link_id: "other-link" },
  ],
};
const context: ShopDelegationContextOut = {
  link: { id: "link", category_id: "goods", activity_id: "festival", name: "給媽媽代訂", created_at: "2026-10-10T00:00:00Z", revoked_at: null },
  student_name: "學生", can_claim: false, can_edit: true, registration: order,
  catalog: [{ id: "goods", name: "校慶商品", activity_id: "festival", activity_name: "校慶", sort_order: 0, products: [product], series: [] }],
  promotions: [], closed_category_ids: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, "", "/shop#delegate=synthetic-test-token");
  api.me.mockResolvedValue({ id: "parent", display_name: "媽媽", email: "parent@synthetic.test" });
  api.accessDelegation.mockResolvedValue(context);
  api.getDelegationProduct.mockResolvedValue({ ...product, variant_groups: [], media: [] });
  api.setDelegationProduct.mockResolvedValue(order);
  api.previewDelegationPromotion.mockResolvedValue({ eligible: true, reason_code: "no_promotion", subtotal_price: 500, total_price: 500, discount_amount: 0 });
  api.applyDelegationPromotion.mockResolvedValue(order);
});

describe("原商品頁的家人代訂模式", () => {
  it("一般單品登記後立即提示加購、折抵與商品描邊，能直接開啟缺少的品項", async () => {
    const pants = { ...product, id: "pants", name: "長褲", price: 200 };
    const promotion = {
      id: "bundle", name: "衣褲套組", activity_id: "festival", discount_type: "bundle_price" as const,
      discount_value: 250, min_order_price: 0, min_quantity: 1, target_products: [product, pants],
    };
    api.accessDelegation.mockResolvedValue({ ...context, registration: null,
      catalog: [{ ...context.catalog?.[0], products: [product, pants] }], promotions: [promotion] });
    api.getDelegationProduct.mockImplementation((_token, id) => Promise.resolve({
      ...(id === "pants" ? pants : product), variant_groups: [], media: [],
    }));
    let finishSave: (value: OrderOut) => void = () => {};
    api.setDelegationProduct.mockImplementation(() => new Promise<OrderOut>((resolve) => { finishSave = resolve; }));
    render(<ShopPage />);
    const section = await screen.findByRole("region", { name: "組合購買專區" });
    expect(section.compareDocumentPosition(screen.getByRole("navigation", { name: "選擇商品活動" }))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看商品：紀念袋" }));
    await screen.findByRole("heading", { name: "紀念袋", level: 3 });
    expect(screen.queryByRole("region", { name: "套組加購建議" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "登記購買 · NT$100" }));
    await act(async () => finishSave({ ...order, subtotal_price: 100, total_price: 100,
      items: [{ ...order.items[1], quantity: 1, subtotal: 100 }] }));
    const addons = await screen.findByRole("region", { name: "套組加購建議" });
    expect(addons).toHaveTextContent("再加購長褲，湊齊一套可省 NT$50");
    expect(screen.getByRole("article", { name: "長褲商品" })).toHaveAttribute("data-bundle-addon", "true");
    fireEvent.click(within(addons).getByRole("button", { name: "加購長褲" }));
    await screen.findByRole("heading", { name: "長褲", level: 3 });
    expect(screen.getByText("正在選購「衣褲套組」，每項各一件；選齊後享套組價。")).toBeVisible();
  });

  it.each([false, true])("上方專區跨活動選購，已收款時停用加購（收款：%s）", async (paid) => {
    const pants = { ...product, id: "pants", name: "長褲", price: 200 };
    const other = { ...context.catalog![0], id: "other", activity_id: "other-event", name: "其他活動",
      products: [{ ...product, id: "other-product", name: "其他商品" }] };
    api.accessDelegation.mockResolvedValue({ ...context, registration: paid ? { ...order, is_paid: true } : null,
      catalog: [other, { ...context.catalog![0], products: [product, pants] }], promotions: [{
        id: "bundle", name: "衣褲套組", activity_id: "festival", discount_type: "bundle_price",
        discount_value: 250, min_order_price: 0, min_quantity: 1, target_products: [product, pants], code: "SET",
      }] });
    render(<ShopPage />);
    const bundle = await screen.findByRole("article", { name: "衣褲套組" });
    if (paid) {
      expect(within(bundle).getByRole("button", { name: "加購湊齊套組" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: /校慶商品/ }));
      expect(screen.getByRole("article", { name: "長褲商品" })).not.toHaveAttribute("data-bundle-addon");
    } else {
      expect(screen.getByRole("heading", { name: "其他活動", level: 2 })).toBeVisible();
      fireEvent.click(within(bundle).getByRole("button", { name: "開始選購套組" }));
      await screen.findByRole("heading", { name: "紀念袋", level: 3 });
      expect(screen.getByRole("heading", { name: "校慶商品", level: 2 })).toBeVisible();
      expect(screen.getByLabelText("優惠適用活動")).toHaveValue("festival");
      expect(screen.getByLabelText("優惠碼")).toHaveValue("SET");
    }
  });

  it.each([false, true])("商品名稱下方直接顯示已套用優惠後單價（系列商品：%s）", async (inSeries) => {
    const cardProduct = { ...product, name: "傳情卡片餅乾套組", price: 40 };
    const products = [cardProduct];
    api.accessDelegation.mockResolvedValue({ ...context, promotions: [], registration: {
      ...order, subtotal_price: 800, discount_amount: 160, total_price: 640, promotion_id: "staff",
      applied_promotions: [{ promotion_id: "staff", name: "班聯會幹部優惠", discount_amount: 160 }],
      items: [{ ...order.items[1], quantity: 20, unit_price: 40, subtotal: 800 }],
    }, catalog: [{ ...context.catalog?.[0], products: inSeries ? [] : products,
      series: inSeries ? [{ id: "cards", name: "傳情商品", products }] : [],
    }] });
    render(<ShopPage />);
    const card = await screen.findByRole("article", { name: "傳情卡片餅乾套組商品" });
    const primaryPrice = card.querySelector(".shop-public-product-price");
    expect(primaryPrice?.querySelector("del")).toHaveTextContent("NT$40");
    expect(primaryPrice?.querySelector(".shop-price-current")).toHaveTextContent("NT$32");
    expect(within(card).getByText("依已登記 20 件計算")).toBeVisible();
    expect(card.querySelector(".shop-product-card-offers")).toBeNull();
  });
  it.each([false, true])("商品卡片直接顯示套組並可選購（系列商品：%s）", async (inSeries) => {
    const pants = { ...product, id: "pants", name: "長褲", price: 200 };
    const products = [product, pants];
    const category = { ...context.catalog?.[0], products: inSeries ? [] : products,
      series: inSeries ? [{ id: "series", name: "紀念系列", products }] : [],
    };
    api.accessDelegation.mockResolvedValue({ ...context, registration: null, catalog: [category], promotions: [{
      id: "bundle", name: "衣褲套組", activity_id: "festival", code: null,
      discount_type: "bundle_price", discount_value: 250, min_order_price: 0, min_quantity: 1,
      target_products: products.map((row) => ({ id: row.id, name: row.name })),
    }] });
    render(<ShopPage />);
    const card = await screen.findByRole("article", { name: "紀念袋商品" });
    expect(within(card).getByText("搭配長褲，每項各一件")).toBeVisible();
    expect(card.querySelector("del")).toHaveTextContent("NT$300");
    expect(within(card).getByLabelText("原價 NT$300，優惠價 NT$250／套")).toBeVisible();
    expect(within(card).getByText("每套省 NT$50")).toBeVisible();
    expect(card.querySelector("a button, button button")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "選購此套組" }));
    expect(await screen.findByText("正在選購「衣褲套組」，每項各一件；選齊後享套組價。")).toBeVisible();
    expect(screen.getByRole("button", { name: "下一項：長褲" })).toBeVisible();
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "關閉" });
    await waitFor(() => expect(close).toHaveFocus());
    within(card).getByRole("button", { name: "選購此套組" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();
  });
  it("套組可逐項選購，選齊後顯示原價刪除線與實付合計", async () => {
    const pants = { ...product, id: "pants", name: "長褲", price: 200 };
    const promotion = {
      id: "bundle", name: "衣褲套組", activity_id: "festival", code: null,
      discount_type: "bundle_price" as const, discount_value: 250, min_order_price: 0, min_quantity: 1,
      target_products: [{ id: "bag", name: "紀念袋" }, { id: "pants", name: "長褲" }],
    };
    api.accessDelegation.mockResolvedValue({ ...context, registration: null,
      catalog: [{ ...context.catalog?.[0], products: [product, pants] }], promotions: [promotion],
    });
    api.getDelegationProduct.mockImplementation((_token, id) => Promise.resolve({
      ...(id === "pants" ? pants : product), variant_groups: [], media: [],
    }));
    api.setDelegationProduct.mockImplementation((_token, id) => Promise.resolve({
      ...order, subtotal_price: id === "pants" ? 300 : 100,
      total_price: id === "pants" ? 250 : 100, discount_amount: id === "pants" ? 50 : 0,
      applied_promotions: id === "pants" ? [{ promotion_id: "bundle", name: "衣褲套組", discount_amount: 50 }] : [],
      items: [
        { ...order.items[1], id: "new-bag", quantity: 1, subtotal: 100 },
        ...(id === "pants" ? [{ ...order.items[1], id: "new-pants", product_id: "pants", product_name: "長褲", quantity: 1, unit_price: 200, subtotal: 200 }] : []),
      ],
    }));
    const { container } = render(<ShopPage />);
    const bundle = await screen.findByRole("article", { name: "衣褲套組" });
    expect(within(bundle).getByText("每套省 NT$50")).toBeVisible();
    expect(bundle.querySelector("del")).toHaveTextContent("NT$300");
    fireEvent.click(within(bundle).getByRole("button", { name: "開始選購套組" }));
    await screen.findByRole("heading", { name: "紀念袋", level: 3 });
    expect(screen.getByRole("button", { name: "下一項：長褲" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "登記購買 · NT$100" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "下一項：長褲" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "下一項：長褲" }));
    await screen.findByRole("heading", { name: "長褲", level: 3 });
    fireEvent.click(screen.getByRole("button", { name: "登記購買 · NT$200" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "完成套組選購" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "完成套組選購" }));
    expect(await screen.findByText("共省 NT$50", { exact: false })).toBeVisible();
    const summary = container.querySelector(".shop-registration-price");
    expect(summary?.querySelector("del")).toHaveTextContent("NT$300");
    expect(summary).toHaveTextContent("NT$250");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("單品優惠價會同時顯示原價與優惠價", async () => {
    api.accessDelegation.mockResolvedValue({ ...context, registration: null, promotions: [{
      id: "sale", name: "商品九折", activity_id: "festival", code: null,
      discount_type: "percentage", discount_value: 10, min_order_price: 0, min_quantity: 1,
      target_products: [],
    }] });
    const { container } = render(<ShopPage />);
    await screen.findByRole("button", { name: /紀念袋/ });
    const price = container.querySelector(".shop-public-product-price");
    expect(price?.querySelector("del")).toHaveTextContent("NT$100");
    expect(price).toHaveTextContent("NT$90");
  });
  it.each([
    { email: "g0991001@hchs.hc.edu.tw", is_school_email: true },
    { email: "private@example.test", is_school_email: false },
  ])("uses server eligibility for a student signing in with $email without a student_id field", async (account) => {
    window.history.replaceState({}, "", "/shop");
    api.me.mockResolvedValue({ id: "student", display_name: "學生", ...account, can_create_shop_delegation: true });
    api.catalog.mockResolvedValue(context.catalog);
    api.listAvailablePromotions.mockResolvedValue([]);
    api.getCurrentRegistrations.mockResolvedValue([]);
    api.listDelegationLinks.mockResolvedValue([]);
    render(<ShopPage />);
    fireEvent.click(await screen.findByRole("button", { name: "家人代訂" }));
    expect(await screen.findByRole("textbox", { name: "邀請誰來代訂" })).toBeVisible();
    expect(screen.getByRole("button", { name: "建立代訂驗證碼" })).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: "學生提供的七位數代訂驗證碼" })).not.toBeInTheDocument();
  });

  it("does not treat a teacher's school-email flag as student authorization", async () => {
    window.history.replaceState({}, "", "/shop");
    api.me.mockResolvedValue({ id: "teacher", email: "teacher@hchs.hc.edu.tw", is_school_email: true, can_create_shop_delegation: false });
    api.catalog.mockResolvedValue(context.catalog);
    api.listAvailablePromotions.mockResolvedValue([]);
    api.getCurrentRegistrations.mockResolvedValue([]);
    render(<ShopPage />);
    fireEvent.click(await screen.findByRole("button", { name: "家人代訂" }));
    expect(await screen.findByRole("textbox", { name: "學生提供的七位數代訂驗證碼" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "邀請誰來代訂" })).not.toBeInTheDocument();
    expect(api.listDelegationLinks).not.toHaveBeenCalled();
  });

  it("enters the same explicit binding flow after a parent submits a seven-digit code", async () => {
    window.history.replaceState({}, "", "/shop");
    api.catalog.mockResolvedValue(context.catalog);
    api.listAvailablePromotions.mockResolvedValue([]);
    api.getCurrentRegistrations.mockResolvedValue([]);
    api.exchangeDelegationCode.mockResolvedValue({ token: "synthetic-code-link-token" });
    api.accessDelegation.mockResolvedValue({ ...context, can_claim: true, can_edit: false, registration: null });
    render(<ShopPage />);
    fireEvent.click(await screen.findByRole("button", { name: "家人代訂" }));
    const code = await screen.findByRole("textbox", { name: "學生提供的七位數代訂驗證碼" });
    fireEvent.change(code, { target: { value: "0123456" } });
    fireEvent.click(screen.getByRole("button", { name: "查看學生授權" }));
    expect(await screen.findByRole("button", { name: "確認授權並開始代訂" })).toBeVisible();
    expect(api.exchangeDelegationCode).toHaveBeenCalledWith("0123456");
    expect(api.accessDelegation).toHaveBeenCalledWith("synthetic-code-link-token", false);
    expect(api.accessDelegation).not.toHaveBeenCalledWith("synthetic-code-link-token", true);
    expect(screen.getByText("媽媽（parent@synthetic.test）")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "確認代訂授權" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "增加數量" })).not.toBeInTheDocument();
  });

  it("uses only this link's rows for editing while displaying the combined order", async () => {
    render(<ShopPage />);
    expect(await screen.findByRole("heading", { name: "給媽媽代訂 · 為 學生 代訂" })).toBeVisible();
    const existingOrder = screen.getByRole("region", { name: "學生在此活動的預購" });
    expect(within(existingOrder).getByText("學生本人和家人已登記的品項只供查看；你只能修改自己透過此連結加入的品項。"))
      .toBeVisible();
    expect(within(existingOrder).getAllByRole("listitem")).toHaveLength(3);
    expect(within(existingOrder).getByRole("link", { name: "查看訂單明細" }))
      .toHaveAttribute("href", "/shop/orders/order");
    expect(screen.getByRole("link", { name: "查看我的代訂訂單" })).toHaveAttribute("href", "/shop/orders");
    expect(screen.getByText("已登記 5 件")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "查看商品：紀念袋" }));
    const increase = await screen.findByRole("button", { name: "增加數量" });
    fireEvent.click(increase);
    await waitFor(() => expect(api.setDelegationProduct).toHaveBeenCalledWith("synthetic-test-token", "bag", {
      variants: [{ option_ids: [], quantity: 2 }],
    }));
    expect(api.setCurrentRegistrationProduct).not.toHaveBeenCalled();
    expect(api.getCurrentRegistrations).not.toHaveBeenCalled();
    expect(api.previewDelegationPromotion).toHaveBeenCalledWith("synthetic-test-token", null);
  });

  it("marks a registered product card as an entry to adjust its quantity directly", async () => {
    render(<ShopPage />);
    const card = await screen.findByRole("article", { name: "紀念袋商品" });

    expect(within(card).getByText("調整規格與數量")).toBeVisible();
    fireEvent.click(within(card).getByRole("button", { name: "查看商品：紀念袋" }));
    fireEvent.click(await screen.findByRole("button", { name: "移除這項登記" }));

    await waitFor(() => expect(api.setDelegationProduct).toHaveBeenCalledWith(
      "synthetic-test-token", "bag", { variants: [] },
    ));
  });

  it("edits a classmate's total across orders and keeps paid quantity as the minimum", async () => {
    const paidOrder: OrderOut = {
      ...order, id: "paid-order", is_paid: true, subtotal_price: 500, total_price: 500,
      items: [{ ...order.items[0], id: "locked-item", quantity: 5, subtotal: 500 }],
    };
    const editableOrder: OrderOut = {
      ...order, id: "editable-order", subtotal_price: 100, total_price: 100,
      items: [{ ...order.items[0], id: "editable-item", quantity: 1, subtotal: 100 }],
    };
    window.history.replaceState({}, "", "/shop?class_member_user_id=student&class_member_name=%E7%A4%BA%E7%AF%84%E7%94%B2");
    api.catalog.mockResolvedValue(context.catalog);
    api.listAvailablePromotions.mockResolvedValue([]);
    api.listClassMemberRegistrations.mockResolvedValue([paidOrder, editableOrder]);
    api.getProduct.mockResolvedValue({ ...product, variant_groups: [], media: [] });
    api.setClassMemberProduct.mockResolvedValue([paidOrder]);
    render(<ShopPage />);

    expect(await screen.findByText("調整對象：示範甲")).toBeVisible();
    const card = await screen.findByRole("article", { name: "紀念袋商品" });
    expect(await within(card).findByText("已登記 6 件")).toBeVisible();
    fireEvent.click(within(card).getByRole("button", { name: "查看商品：紀念袋" }));
    expect(await screen.findByText("已收款或鎖定 5 件，調整時會保留這個數量。"))
      .toBeVisible();
    expect(screen.getByRole("button", { name: "移除可調整數量" })).toBeEnabled();
    const decrease = await screen.findByRole("button", { name: "減少數量" });
    fireEvent.click(decrease);
    await waitFor(() => expect(api.setClassMemberProduct).toHaveBeenCalledWith(
      "student", "bag", { variants: [{ option_ids: [], quantity: 5 }] },
    ));
    await waitFor(() => expect(screen.getByRole("button", { name: "減少數量" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "已保留鎖定數量" })).toBeDisabled();
    expect(api.getCurrentRegistrations).not.toHaveBeenCalled();
    expect(api.setCurrentRegistrationProduct).not.toHaveBeenCalled();
  });

  it("requires an explicit account claim before showing an editable modal", async () => {
    api.accessDelegation.mockImplementation(async (_token, claim) => claim ? context : {
      ...context, can_claim: true, can_edit: false, registration: null,
    });
    render(<ShopPage />);
    await screen.findByRole("button", { name: "確認授權並開始代訂" });
    expect(screen.getByText("媽媽（parent@synthetic.test）")).toBeVisible();
    expect(screen.getByText(/確認後，這個連結只供目前帳號使用/)).toBeVisible();
    expect(screen.getByText(/^送出即加入學生預購，不需學生再次確認/)).toBeVisible();
    fireEvent.click(screen.getByText("完整操作介紹與權限說明"));
    expect(screen.getByText(/代訂送出後立即加入學生的預購，不需學生再次確認/)).toBeVisible();
    fireEvent.click(within(screen.getByRole("dialog", { name: "確認代訂授權" })).getByRole("button", { name: "關閉" }));
    fireEvent.click(screen.getByRole("button", { name: "查看商品：紀念袋" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "確認授權並開始代訂" }));
    await waitFor(() => expect(api.accessDelegation).toHaveBeenCalledWith("synthetic-test-token", true));
    expect(await screen.findByRole("dialog")).toBeVisible();
  });

  it("guides a parent without a student link without exposing student link management", async () => {
    window.history.replaceState({}, "", "/shop");
    api.catalog.mockResolvedValue(context.catalog);
    api.listAvailablePromotions.mockResolvedValue([]);
    api.getCurrentRegistrations.mockResolvedValue([]);
    render(<ShopPage />);
    const shortcut = await screen.findByRole("button", { name: "家人代訂" });
    expect(screen.queryByRole("textbox", { name: "學生提供的七位數代訂驗證碼" })).not.toBeInTheDocument();
    fireEvent.click(shortcut);
    expect(await screen.findByRole("heading", { name: "輸入代訂驗證碼" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "建立家長代訂連結" })).not.toBeInTheDocument();
    expect(api.listDelegationLinks).not.toHaveBeenCalled();
    expect(api.accessDelegation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "關閉" }));
    api.getProduct.mockResolvedValue({ ...product, variant_groups: [], media: [] });
    fireEvent.click(screen.getByRole("link", { name: "查看商品：紀念袋" }));
    expect(await screen.findByText(/代訂需要學生授權。請輸入學生提供的七位數驗證碼/)).toBeVisible();
    expect(screen.getByRole("button", { name: "登記購買 · NT$100" })).toBeDisabled();
    expect(api.setCurrentRegistrationProduct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "前往代訂，輸入驗證碼" }));
    expect(await screen.findByRole("dialog", { name: "代訂商品" })).toBeVisible();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "學生提供的七位數代訂驗證碼" })).toBeVisible();
  });

  it("opens a product from its direct single-product URL", async () => {
    window.history.replaceState({}, "", "/shop/%E7%B4%80%E5%BF%B5%E8%A2%8B");
    api.catalog.mockResolvedValue(context.catalog);
    api.listAvailablePromotions.mockResolvedValue([]);
    api.getCurrentRegistrations.mockResolvedValue([]);
    api.getProduct.mockResolvedValue({ ...product, variant_groups: [], media: [] });
    render(<ShopPage productSlug="紀念袋" />);

    expect(await screen.findByRole("button", { name: "關閉" })).toBeVisible();
    expect(api.getProduct).toHaveBeenCalledWith("bag");
  });

  it("shows students a scoped create entry while guests receive login guidance", async () => {
    window.history.replaceState({}, "", "/shop");
    api.catalog.mockResolvedValue(context.catalog);
    api.listAvailablePromotions.mockResolvedValue([]);
    api.getCurrentRegistrations.mockResolvedValue([]);
    api.listDelegationLinks.mockResolvedValue([]);
    api.me.mockResolvedValue({ id: "student", display_name: "學生", student_id: "S001" });
    const { unmount } = render(<ShopPage />);
    fireEvent.click(await screen.findByRole("button", { name: "家人代訂" }));
    expect(await screen.findByRole("textbox", { name: "邀請誰來代訂" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "選擇活動" })).toHaveValue("goods");
    expect(screen.queryByRole("textbox", { name: "學生提供的七位數代訂驗證碼" })).not.toBeInTheDocument();
    unmount();
    api.me.mockRejectedValue(new Error("未登入"));
    render(<ShopPage />);
    fireEvent.click(await screen.findByRole("button", { name: "家人代訂" }));
    expect(await screen.findByRole("link", { name: "登入後開始代訂" })).toHaveAttribute("href", "/login?next=%2Fshop%3Fdelegation%3Dentry");
    expect(screen.queryByRole("button", { name: "建立家長代訂連結" })).not.toBeInTheDocument();
  });

  it("returns to the code panel after login without requiring another click", async () => {
    window.history.replaceState({}, "", "/shop?delegation=entry");
    api.catalog.mockResolvedValue(context.catalog);
    api.listAvailablePromotions.mockResolvedValue([]);
    api.getCurrentRegistrations.mockResolvedValue([]);
    render(<ShopPage />);
    expect(await screen.findByRole("textbox", { name: "學生提供的七位數代訂驗證碼" })).toBeVisible();
    expect(window.location.search).toBe("");
    expect(api.listDelegationLinks).not.toHaveBeenCalled();
  });

  it("explains an empty catalog to students without showing the parent's code form", async () => {
    window.history.replaceState({}, "", "/shop");
    api.me.mockResolvedValue({ id: "student", display_name: "學生", student_id: "S001" });
    api.catalog.mockResolvedValue([]);
    api.listAvailablePromotions.mockResolvedValue([]);
    api.getCurrentRegistrations.mockResolvedValue([]);
    render(<ShopPage />);
    fireEvent.click(await screen.findByRole("button", { name: "家人代訂" }));
    expect(await screen.findByText("目前沒有可授權的商品活動，開放預購後即可建立代訂連結。")).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(api.listDelegationLinks).not.toHaveBeenCalled();
  });

  it("identifies a student's own link as read-only rather than inviting account binding", async () => {
    api.accessDelegation.mockResolvedValue({ ...context, can_claim: false, can_edit: false });
    render(<ShopPage />);
    expect(await screen.findByRole("link", { name: "返回本人商品頁" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "確認授權並開始代訂" })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog", { name: "確認代訂授權" })).getByRole("button", { name: "關閉" }));
    fireEvent.click(screen.getByRole("button", { name: "查看商品：紀念袋" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.setDelegationProduct).not.toHaveBeenCalled();
  });

  it("explains that collected registrations cannot be changed in an already bound session", async () => {
    api.accessDelegation.mockResolvedValue({ ...context, registration: { ...order, is_class_collected: true } });
    render(<ShopPage />);
    expect(await screen.findByText("本次預購已收款，品項不能再修改。可查看已登記品項。")).toBeVisible();
  });

  it("keeps revoked links in the delegation error flow", async () => {
    api.accessDelegation.mockRejectedValue(new Error("此代訂連結已撤銷"));
    render(<ShopPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("此代訂連結已撤銷");
    expect(api.getCurrentRegistrations).not.toHaveBeenCalled();
    expect(api.catalog).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "登記購買" })).not.toBeInTheDocument();
  });

  it("keeps the delegation secret out of the login URL", async () => {
    api.me.mockRejectedValue(new Error("未登入"));
    render(<ShopPage />);
    const login = await screen.findByRole("link", { name: "登入自己的帳號開始代訂" });
    expect(login).toHaveAttribute("href", "/login?next=%2Fshop%3Fdelegation%3Dresume");
    expect(api.accessDelegation).not.toHaveBeenCalled();
  });

  it("keeps the delegated identity when using the public skip link", async () => {
    render(<ShopPage />);
    await screen.findByRole("heading", { name: "給媽媽代訂 · 為 學生 代訂" });
    window.history.replaceState({}, "", "/shop#main-content");
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(window.location.hash).toBe("#delegate=synthetic-test-token");
    expect(api.getCurrentRegistrations).not.toHaveBeenCalled();
  });

  it("asks for the original link if login continuation credentials are missing", async () => {
    window.history.replaceState({}, "", "/shop?delegation=resume");
    render(<ShopPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("請重新開啟家人分享的連結");
    expect(api.accessDelegation).not.toHaveBeenCalled();
    expect(api.getCurrentRegistrations).not.toHaveBeenCalled();
  });

  it("ignores an old link's failure after switching to another link", async () => {
    let failOld!: (error: Error) => void;
    api.accessDelegation.mockImplementation((token) => token === "synthetic-test-token"
      ? new Promise<ShopDelegationContextOut>((_resolve, reject) => { failOld = reject; })
      : Promise.resolve({ ...context, link: { ...context.link, name: "新連結" } }));
    render(<ShopPage />);
    await waitFor(() => expect(api.accessDelegation).toHaveBeenCalled());
    window.history.replaceState({}, "", "/shop#delegate=new-synthetic-token");
    fireEvent(window, new HashChangeEvent("hashchange"));
    await screen.findByRole("heading", { name: "新連結 · 為 學生 代訂" });
    await act(async () => { failOld(new Error("舊連結已撤銷")); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "新連結 · 為 學生 代訂" })).toBeVisible();
  });

  it("ignores pending own catalog and orders after entering delegation mode", async () => {
    let finishCatalog!: (catalog: ShopDelegationContextOut["catalog"]) => void;
    let finishOrders!: (orders: OrderOut[]) => void;
    window.history.replaceState({}, "", "/shop");
    api.catalog.mockImplementation(() => new Promise((resolve) => { finishCatalog = resolve; }));
    api.getCurrentRegistrations.mockImplementation(() => new Promise((resolve) => { finishOrders = resolve; }));
    api.listAvailablePromotions.mockResolvedValue([]);
    render(<ShopPage />);
    await waitFor(() => expect(api.getCurrentRegistrations).toHaveBeenCalled());
    window.history.replaceState({}, "", "/shop#delegate=synthetic-test-token");
    fireEvent(window, new HashChangeEvent("hashchange"));
    await screen.findByRole("heading", { name: "給媽媽代訂 · 為 學生 代訂" });
    await act(async () => {
      finishCatalog([{ ...context.catalog![0], id: "own-category", name: "本人其他活動", products: [], series: [] }]);
      finishOrders([]);
    });
    expect(screen.getByText("已登記 5 件")).toBeVisible();
    expect(screen.getByRole("button", { name: "查看商品：紀念袋" })).toBeVisible();
    expect(screen.queryByText("本人其他活動")).not.toBeInTheDocument();
  });

  it("uses the latest link if it changes while the login account is loading", async () => {
    let finishLogin!: (account: { id: string; display_name: string; email: string }) => void;
    api.me.mockImplementation(() => new Promise((resolve) => { finishLogin = resolve; }));
    render(<ShopPage />);
    window.history.replaceState({}, "", "/shop#delegate=new-synthetic-token");
    fireEvent(window, new HashChangeEvent("hashchange"));
    await act(async () => { finishLogin({ id: "parent", display_name: "家人", email: "parent@synthetic.test" }); });
    await screen.findByRole("heading", { name: "給媽媽代訂 · 為 學生 代訂" });
    expect(api.accessDelegation).toHaveBeenCalledWith("new-synthetic-token", false);
    expect(api.accessDelegation).not.toHaveBeenCalledWith("synthetic-test-token", false);
  });
});
