import { describe, expect, it } from "vitest";
import type { CatalogProductOut, OrderOut, ShopPromotionPublicOut } from "@/lib/types";
import { bundleProductAvailable, bundleProgress } from "./shop-bundle-progress";

const shirt: CatalogProductOut = {
  id: "shirt", name: "上衣", price: 300, image_url: null, status: "active",
  is_unlimited: false, stock_quantity: 10, has_variants: false, requires_seating: false,
};
const pants = { ...shirt, id: "pants", name: "長褲", price: 500 };
const products = new Map([[shirt.id, shirt], [pants.id, pants]]);
const promotion: ShopPromotionPublicOut = {
  id: "bundle", name: "衣褲套組", discount_type: "bundle_price", discount_value: 650,
  min_order_price: 0, min_quantity: 1, target_products: [shirt, pants],
};
const registration = (quantities: number[]): Pick<OrderOut, "items"> => ({
  items: quantities.map((quantity, index) => ({
    id: `item-${index}`, product_id: index === 0 ? "shirt" : "pants", product_name: "商品",
    quantity, unit_price: 300, subtotal: quantity * 300, selected_options: [],
  })),
});

describe("套組加購進度", () => {
  it("尚未購買時顯示完整套組，部分購買時只推薦缺少品項", () => {
    expect(bundleProgress(promotion, products, null)).toMatchObject({
      started: false, completedSets: 0, original: 800, saving: 150, missing: [shirt, pants],
    });
    expect(bundleProgress(promotion, products, registration([1, 0]))).toMatchObject({
      started: true, completedSets: 0, missing: [pants],
    });
  });

  it("按各商品總量計算下一套，不將已有一套誤判為全數湊齊", () => {
    expect(bundleProgress(promotion, products, registration([2, 1]))).toMatchObject({
      completedSets: 1, started: true, missing: [pants],
    });
    expect(bundleProgress(promotion, products, registration([2, 2]))).toMatchObject({
      completedSets: 2, started: false, missing: [],
    });
    const variants = { items: [...registration([1, 1]).items, registration([2]).items[0]] };
    expect(bundleProgress(promotion, products, variants).quantities.get("shirt")).toBe(3);
  });

  it("缺少公開價格時不冒算折抵，缺貨與尚未開賣時不可加購", () => {
    expect(bundleProgress(promotion, new Map([[shirt.id, shirt]]), registration([1]))).toMatchObject({
      original: null, saving: null, unavailable: true,
    });
    expect(bundleProductAvailable({ ...pants, stock_quantity: 0 })).toBe(false);
    expect(bundleProductAvailable({ ...pants, sale_start: "2099-01-01T00:00:00Z" })).toBe(false);
    expect(bundleProductAvailable({ ...pants, sale_end: "2020-01-01T00:00:00Z" })).toBe(false);
    expect(bundleProductAvailable({ ...pants, is_unlimited: true, stock_quantity: 0 })).toBe(true);
  });
});
