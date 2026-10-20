import { describe, expect, it } from "vitest";
import type { OrderOut, ShopPromotionPublicOut } from "./types";
import { productOfferPrice } from "./shop-promotion-price";

const product = { id: "shirt", price: 300 };
const promotion: ShopPromotionPublicOut = {
  id: "sale", name: "商品優惠", activity_id: "festival", code: null,
  discount_type: "percentage", discount_value: 10, min_quantity: 1, min_order_price: 0,
  target_products: [{ id: "shirt", name: "衣服" }], product_price_overrides: [],
};

describe("商品價格的優惠顯示", () => {
  it("顯示百分比優惠，並將指定單價優惠的規格加價保留", () => {
    expect(productOfferPrice(product, [promotion], "festival", null)).toBe(270);
    expect(productOfferPrice(product, [{ ...promotion, discount_type: "price_override",
      product_price_overrides: [{ product_id: "shirt", product_name: "衣服", unit_price: 250 }],
    }], "festival", null, 50)).toBe(300);
  });

  it("未兌換的優惠碼、其他活動、滿件及套組均不冒充單品價格", () => {
    for (const candidate of [
      { ...promotion, code: "SAVE" }, { ...promotion, activity_id: "other" },
      { ...promotion, min_quantity: 2 }, { ...promotion, min_order_price: 500 },
      { ...promotion, discount_type: "bundle_price" as const, discount_value: 400 },
      { ...promotion, discount_type: "fixed" as const, discount_value: 100 },
    ]) expect(productOfferPrice(product, [candidate], "festival", null)).toBe(300);
  });

  it("已有登記時只顯示實際套用且可歸屬單品的優惠", () => {
    const order = { promotion_id: "sale", applied_promotions: [{ promotion_id: "sale" }] } as OrderOut;
    expect(productOfferPrice(product, [{ ...promotion, code: "SAVE" }], "festival", order)).toBe(270);
    expect(productOfferPrice(product, [{ ...promotion, id: "unused", discount_value: 50 }], "festival", order)).toBe(300);
  });

  it("多件百分比優惠按合計取整數，不逐件捨去折扣", () => {
    expect(productOfferPrice({ id: "shirt", price: 99 }, [promotion], "festival", null, 0, 3)).toBe(268);
  });
});
