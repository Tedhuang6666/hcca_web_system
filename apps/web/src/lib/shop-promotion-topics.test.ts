import { expect, it } from "vitest";
import type { ShopPromotionPublicOut } from "./types";
import { productOfferPrice } from "./shop-promotion-price";

const offer = { gift_quantity: 1, id: "promo", name: "幹部價", target_category_ids: ["clothes", "gifts"],
  discount_type: "price_override", discount_value: 0, min_order_price: 0, min_quantity: 1,
  target_products: [{ id: "shirt", name: "衣服" }, { id: "cup", name: "杯子" }],
  product_price_overrides: [{ product_id: "shirt", product_name: "衣服", unit_price: 100 },
    { product_id: "cup", product_name: "杯子", unit_price: 50 }],
} satisfies ShopPromotionPublicOut;

it("跨分類指定價格依商品分類套用，分類外商品保持原價", () => {
  expect(productOfferPrice({ id: "shirt", price: 300 }, [offer], null, 20, 1, "clothes")).toBe(120);
  expect(productOfferPrice({ id: "cup", price: 200 }, [offer], null, 0, 1, "gifts")).toBe(50);
  expect(productOfferPrice({ id: "cup", price: 200 }, [offer], null, 0, 1, "other")).toBe(200);
});

it("不限分類的優惠可用於任何商品分類", () => {
  const automatic = { ...offer, discount_type: "percentage", discount_value: 10,
    target_category_ids: [], target_products: [], product_price_overrides: [] } satisfies ShopPromotionPublicOut;
  expect(productOfferPrice({ id: "shirt", price: 300 }, [automatic], null, 0, 1, "clothes")).toBe(270);
  expect(productOfferPrice({ id: "shirt", price: 300 }, [{ ...automatic, target_category_ids: null }], null, 0, 1, "clothes")).toBe(270);
});
