import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OrderOut, ShopPromotionPublicOut } from "@/lib/types";
import ProductDetailOffers from "./ProductDetailOffers";

const product = { id: "shirt", name: "紀念衫", price: 300 };
const promotion: ShopPromotionPublicOut = { gift_quantity: 1,
  id: "sale", name: "校慶九折", discount_type: "percentage", discount_value: 10,
  min_order_price: 0, min_quantity: 1, target_products: [{ id: product.id, name: product.name }],
};
const gift: ShopPromotionPublicOut = { ...promotion, id: "gift", name: "中獎贈品", discount_value: 100 };
const order: OrderOut = {
  id: "order", serial_number: "ORDER-001", user_id: "student", status: "pending",
  created_at: "2026-11-07T00:00:00Z", updated_at: "2026-11-07T00:00:00Z",
  assistance_scope: "self", payment_method: "cash_on_pickup", is_paid: false, is_class_collected: false,
  subtotal_price: 700, total_price: 650,
  items: [{ gift_quantity: 0, gift_discount_amount: 0, id: "item", product_id: product.id, quantity: 2, selected_options: [], unit_price: 350, subtotal: 700 }],
  applied_promotions: [
    { promotion_id: "sale", name: "校慶九折", discount_amount: 30 },
    { promotion_id: "coupon", name: "迎新折價券", code: "WELCOME", discount_amount: 20 },
  ],
  discount_amount: 50,
};

describe("商品詳情優惠與贈品", () => {
  it("大量優惠預設只顯示摘要，可展開全部明細並再次收合", () => {
    render(<ProductDetailOffers product={product} registration={order} promotions={
      Array.from({ length: 20 }, (_, index) => ({ ...promotion, id: `offer-${index}`, name: `優惠 ${index + 1}` }))
    } />);
    const section = screen.getByRole("region", { name: "優惠與贈品" });
    expect(within(section).getByText("共 22 項 · 已套用 2 項")).toBeVisible();
    expect(within(section).getByText("優惠 20")).not.toBeVisible();
    fireEvent.click(within(section).getByText("優惠與贈品"));
    expect(within(section).getAllByRole("listitem")).toHaveLength(22);
    expect(within(section).getByText("優惠 20")).toBeVisible();
    fireEvent.click(within(section).getByText("優惠與贈品"));
    expect(within(section).getByText("優惠 20")).not.toBeVisible();
  });

  it("逐筆列出套用的多組優惠、各自折抵與未套用套組，不合併名稱", () => {
    render(<ProductDetailOffers product={product} registration={order} promotions={[
      promotion, { ...promotion, id: "bundle", name: "衣褲套組", discount_type: "bundle_price", discount_value: 650,
        target_products: [product, { id: "pants", name: "長褲" }] },
      { ...promotion, id: "bundle2", name: "衣袋套組", discount_type: "bundle_price", discount_value: 350,
        target_products: [product, { id: "bag", name: "提袋" }] },
    ]} />);
    const section = screen.getByRole("region", { name: "優惠與贈品" });
    fireEvent.click(within(section).getByText("優惠與贈品"));
    expect(within(section).getAllByRole("listitem")).toHaveLength(4);
    const sale = within(section).getByRole("listitem", { name: "校慶九折" });
    expect(sale).toHaveTextContent("已套用");
    expect(sale).toHaveTextContent("本筆登記折抵 NT$30");
    const coupon = within(section).getByRole("listitem", { name: "迎新折價券" });
    expect(coupon).toHaveTextContent("本筆登記折抵 NT$20");
    expect(coupon).toHaveTextContent("WELCOME");
    expect(within(section).getByRole("listitem", { name: "衣褲套組" })).toHaveTextContent("尚未套用");
    expect(within(section).getByRole("listitem", { name: "衣袋套組" })).toHaveTextContent("紀念衫 ＋ 提袋");
  });

  it("贈品明列品名、基本售價免費與未登記狀態", () => {
    render(<ProductDetailOffers product={product} promotions={[gift]} registration={null} />);
    fireEvent.click(screen.getByText("優惠與贈品"));
    expect(screen.getByText("贈品：紀念衫")).toBeVisible();
    expect(screen.getByText("尚未登記贈品")).toBeVisible();
    expect(screen.getByText(/每項贈送 1 件.*可加購多件，超出件數與規格加價另計/)).toBeVisible();
    expect(screen.getByText(/請選擇規格並登記/)).toBeVisible();
    expect(screen.queryByText(/^已登記.*已套用贈品優惠$/)).not.toBeInTheDocument();
  });

  it("依後端結果更新贈品狀態，已選品項但未套用時不可宣稱贈送", () => {
    const view = render(<ProductDetailOffers product={product} promotions={[gift]} registration={order} />);
    fireEvent.click(screen.getByText("優惠與贈品"));
    expect(screen.getByText("已登記 2 件，尚未套用贈品優惠")).toBeVisible();
    view.rerender(<ProductDetailOffers product={product} promotions={[gift]} registration={{ ...order,
      applied_promotions: [{ promotion_id: "gift", name: gift.name, discount_amount: 600 }],
    }} />);
    expect(screen.getByText("已登記 2 件，已套用贈品優惠")).toBeVisible();
    expect(screen.getByText("本筆登記折抵 NT$600")).toBeVisible();
    fireEvent.click(screen.getByText("優惠與贈品"));
    expect(screen.getByText("共 1 項 · 已套用 1 項")).toBeVisible();
    expect(screen.queryByText(/尚未套用贈品/)).not.toBeInTheDocument();
  });

  it("同組優惠已套用其他商品，未登記此贈品時仍顯示尚未登記", () => {
    render(<ProductDetailOffers product={product} promotions={[{ ...gift, target_products: [product, { id: "bag", name: "提袋" }] }]}
      registration={{ ...order, items: [], applied_promotions: [{ promotion_id: "gift", name: gift.name, discount_amount: 100 }] }} />);
    fireEvent.click(screen.getByText("優惠與贈品"));
    expect(screen.getByText("尚未登記贈品")).toBeVisible();
    expect(screen.getByText("贈品：紀念衫、提袋")).toBeVisible();
    expect(screen.queryByText(/已登記.*已套用贈品/)).not.toBeInTheDocument();
  });

  it("指定零元價是贈品；全單百分之百折抵不誤稱特定商品贈品", () => {
    const view = render(<ProductDetailOffers product={product} registration={null} promotions={[{
      ...promotion, discount_type: "price_override", product_price_overrides: [
        { product_id: product.id, product_name: product.name, unit_price: 0 },
      ],
    }]} />);
    fireEvent.click(screen.getByText("優惠與贈品"));
    expect(screen.getByText("贈品：紀念衫")).toBeVisible();
    view.rerender(<ProductDetailOffers product={product} registration={null} promotions={[{ ...gift, target_products: [] }]} />);
    expect(screen.queryByText(/贈品：/)).not.toBeInTheDocument();
    expect(screen.getByText("適用商品折抵 100%")).toBeVisible();
  });

  it("列出活動門檻、優惠碼及多品特價的獨立適用規則", () => {
    const topicPromotion = {
      ...promotion, code: "STAFF", target_category_ids: [], min_quantity: 2, min_order_price: 1000,
      discount_type: "price_override" as const, target_products: [product, { id: "bag", name: "提袋" }],
      product_price_overrides: [{ product_id: product.id, product_name: product.name, unit_price: 250 }],
    };
    render(<ProductDetailOffers product={product} registration={null} promotions={[topicPromotion]} />);
    fireEvent.click(screen.getByText("優惠與贈品"));
    expect(screen.getByText(/單一活動滿 NT\$1,000/)).toBeVisible();
    expect(screen.getByText(/單一活動滿 2 件/)).toBeVisible();
    expect(screen.getByText(/使用優惠碼 STAFF/)).toBeVisible();
    expect(screen.getByText(/本商品基本售價 NT\$250/)).toBeVisible();
    expect(screen.queryByText(/需同時選購/)).not.toBeInTheDocument();
  });

  it.each(["loading", "error"] as const)("%s 時不把舊登記當成已套用或未贈送的確定結果", (state) => {
    render(<ProductDetailOffers product={product} promotions={[gift]} registration={{ ...order,
      applied_promotions: [{ promotion_id: "gift", name: gift.name, discount_amount: 600 }],
    }} registrationState={state} />);
    expect(screen.getByRole("status")).toHaveTextContent(state === "loading" ? "正在確認優惠與贈品狀態" : "無法確認優惠與贈品狀態");
    expect(screen.queryByText(/已登記 2 件/)).not.toBeInTheDocument();
    expect(screen.queryByText("尚未登記贈品")).not.toBeInTheDocument();
    expect(screen.queryByText(/已套用 \d+ 項/)).not.toBeInTheDocument();
  });

  it("舊版單一優惠以實際總折抵補列，零折抵不標成已贈送", () => {
    render(<ProductDetailOffers product={product} promotions={[gift]} registration={{ ...order,
      promotion_id: "gift", promotion_code: "GIFT", applied_promotions: [], discount_amount: 0,
    }} />);
    fireEvent.click(screen.getByText("優惠與贈品"));
    expect(screen.getByText("已登記 2 件，尚未套用贈品優惠")).toBeVisible();
  });

  it("沒有相關優惠時不顯示空區塊，也不顯示其他商品的未套用優惠", () => {
    const { container } = render(<ProductDetailOffers product={product} registration={null}
      promotions={[{ ...promotion, target_products: [{ id: "pants", name: "長褲" }] }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("同一優惠出現在多筆收款與加購登記時合計折抵，每組只列一次", () => {
    render(<ProductDetailOffers product={product} promotions={[promotion]} registration={{ ...order,
      applied_promotions: [...order.applied_promotions!, { promotion_id: "sale", name: promotion.name, discount_amount: 60 },
        { promotion_id: "coupon", name: "迎新折價券", code: "WELCOME", discount_amount: 10 }],
    }} />);
    fireEvent.click(screen.getByText("優惠與贈品"));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("listitem", { name: promotion.name })).toHaveTextContent("本筆登記折抵 NT$90");
    expect(screen.getByRole("listitem", { name: "迎新折價券" })).toHaveTextContent("本筆登記折抵 NT$30");
  });
});
