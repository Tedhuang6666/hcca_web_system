import { expect, it } from "vitest";
import type { ShopPromotionPublicOut } from "./types";
import { productOfferPrice } from "./shop-promotion-price";

const offer = { gift_quantity: 1, id: "promo", name: "幹部價", activity_id: null, target_category_ids: ["clothes", "gifts"],
  discount_type: "price_override", discount_value: 0, min_order_price: 0, min_quantity: 1,
  target_products: [{ id: "shirt", name: "衣服" }, { id: "cup", name: "杯子" }],
  product_price_overrides: [{ product_id: "shirt", product_name: "衣服", unit_price: 100 },
    { product_id: "cup", product_name: "杯子", unit_price: 50 }],
} satisfies ShopPromotionPublicOut;

it("跨主題指定價格不再以單一活動過濾，主題外商品保持原價", () => {
  expect(productOfferPrice({ id: "shirt", price: 300 }, [offer], "event-1", null, 20, 1, "clothes")).toBe(120);
  expect(productOfferPrice({ id: "cup", price: 200 }, [offer], "event-2", null, 0, 1, "gifts")).toBe(50);
  expect(productOfferPrice({ id: "cup", price: 200 }, [offer], "event-2", null, 0, 1, "other")).toBe(200);
});

it("不限主題的優惠可用於任何活動，舊優惠仍保留原活動範圍", () => {
  const automatic = { ...offer, discount_type: "percentage", discount_value: 10,
    target_category_ids: [], target_products: [], product_price_overrides: [] } satisfies ShopPromotionPublicOut;
  expect(productOfferPrice({ id: "shirt", price: 300 }, [automatic], "event", null)).toBe(270);
  expect(productOfferPrice({ id: "shirt", price: 300 }, [{ ...automatic, target_category_ids: null }], "event", null)).toBe(300);
});
