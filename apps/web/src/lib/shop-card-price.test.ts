import { describe, expect, it } from "vitest";
import type { OrderOut, ShopPromotionPublicOut } from "./types";
import { shopCardPrice } from "./shop-card-price";

const product = { id: "card", price: 40 };
const promotion: ShopPromotionPublicOut = {
  id: "staff", name: "班聯會幹部優惠", activity_id: "festival", code: null,
  discount_type: "percentage", discount_value: 20, min_quantity: 20, min_order_price: 800,
  target_products: [{ id: "card", name: "傳情卡片餅乾套組" }],
};
const order: OrderOut = {
  id: "order", serial_number: "SYNTHETIC-001", user_id: "student", activity_id: "festival",
  status: "pending", assistance_scope: "self", payment_method: "school_collection",
  created_at: "2026-10-21T00:00:00Z", updated_at: "2026-10-21T00:00:00Z",
  subtotal_price: 800, discount_amount: 160, total_price: 640, promotion_id: "staff",
  is_paid: false, is_class_collected: false,
  applied_promotions: [{ promotion_id: "staff", name: "班聯會幹部優惠", discount_amount: 160 }],
  items: [{ id: "item", product_id: "card", quantity: 20, unit_price: 40, subtotal: 800, selected_options: [] }],
};

describe("商品名稱下方的實際折後單價", () => {
  it("20件已滿優惠門檻時，以800折為640顯示原40與新32", () => {
    expect(shopCardPrice(product, [promotion], "festival", order))
      .toEqual({ original: 40, current: 32, note: "依已登記 20 件計算" });
  });

  it("隱藏的帳號優惠與固定折抵也以實際金額顯示", () => {
    expect(shopCardPrice(product, [], "festival", order).current).toBe(32);
    expect(shopCardPrice(product, [], "festival", { ...order, total_price: 600, discount_amount: 200 }).current).toBe(30);
  });

  it("混合商品只把指定優惠分配給適用品項", () => {
    const mixed = { ...order, subtotal_price: 1000, total_price: 840, items: [...order.items, {
      ...order.items[0], id: "other", product_id: "other", quantity: 2, unit_price: 100, subtotal: 200,
    }] };
    expect(shopCardPrice(product, [promotion], "festival", mixed).current).toBe(32);
    expect(shopCardPrice({ id: "other", price: 100 }, [promotion], "festival", mixed).current).toBe(100);
    expect(shopCardPrice(product, [], "festival", mixed).current).toBe(40);
  });

  it("套組組合價保留套組語意，不直接當成某一單品價格", () => {
    const mixed = { ...order, subtotal_price: 1000, total_price: 840, items: [...order.items, {
      ...order.items[0], id: "other", product_id: "other", quantity: 2, unit_price: 100, subtotal: 200,
    }] };
    expect(shopCardPrice(product, [{ ...promotion, discount_type: "bundle_price" }], "festival", mixed).current).toBe(40);
  });

  it("無法整除時標示約略均價，且保留所選規格的原價", () => {
    const fractional = { ...order, subtotal_price: 120, discount_amount: 20, total_price: 100,
      items: [{ ...order.items[0], quantity: 3, subtotal: 120 }] };
    expect(shopCardPrice(product, [], "festival", fractional))
      .toEqual({ original: 40, current: 33.33, note: "折後平均單價（約）" });
  });
});
