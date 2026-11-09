import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OptionPrice from "./OptionPrice";
import ShopPrice from "./ShopPrice";
import { shopCardPrice } from "@/lib/shop-card-price";
import { productOfferPrice } from "@/lib/shop-promotion-price";
import { bundleProgress } from "@/lib/shop-bundle-progress";
import { registrationReferenceSubtotal } from "@/lib/shop-reference-price";
import type { CatalogProductOut, OrderOut, ShopPromotionPublicOut } from "@/lib/types";

const shirt: CatalogProductOut = {
  id: "shirt", name: "紀念衫", price: 300, original_price: 400, status: "active",
  is_unlimited: true, stock_quantity: 50,
  has_variants: true, has_option_surcharge: true, purchase_allowed: true, requires_seating: false,
};
const pants = { ...shirt, id: "pants", price: 500, original_price: 600 };
const promotion: ShopPromotionPublicOut = { gift_quantity: 1,
  id: "percentage", name: "九折", discount_type: "percentage", discount_value: 10,
  target_products: [{ id: "shirt", name: "紀念衫" }], min_order_price: 0, min_quantity: 1,
};

describe("商品與加價選項的原價", () => {
  it("原價400、售價300再九折為270，不以原價折扣", () => {
    expect(productOfferPrice(shirt, [promotion], null, null)).toBe(270);
    const price = shopCardPrice(shirt, [promotion], null, null);
    expect(price).toEqual({ original: 400, current: 270 });
    render(<ShopPrice {...price} />);
    expect(screen.getByText("NT$400").tagName).toBe("DEL");
    expect(screen.getByLabelText("原價 NT$400，優惠價 NT$270")).toBeVisible();
  });

  it("套組比較總原價1000與套組價650，實售價仍保持300與500", () => {
    const result = bundleProgress({ ...promotion, discount_type: "bundle_price", discount_value: 650,
      target_products: [shirt, pants] }, new Map([[shirt.id, shirt], [pants.id, pants]]), null);
    expect(result).toMatchObject({ original: 1000, saving: 350 });
    expect(shirt.price + pants.price).toBe(800);
    const subtotal = registrationReferenceSubtotal([
      { product_id: "shirt", quantity: 3, unit_price: 350, selected_options: [{ price_delta: 50, original_price_delta: 100 }] },
      { product_id: "pants", quantity: 2, unit_price: 500, selected_options: [] },
    ], new Map([[shirt.id, shirt], [pants.id, pants]]));
    expect(subtotal).toBe(2700);
    // 套組及優惠碼已由 API 將實售小計2050折為1700；全部優惠合計省1000。
    expect(subtotal - 1700).toBe(1000);
  });

  it("規格原加價100折為50，以及折為0時都顯示實際價差", () => {
    const view = render(<OptionPrice option={{ original_price_delta: 100, price_delta: 50 }} />);
    expect(screen.getByText("+NT$100").tagName).toBe("DEL");
    expect(screen.getByLabelText("原加價 +NT$100，優惠加價 +NT$50")).toBeVisible();
    view.rerender(<OptionPrice option={{ original_price_delta: 100, price_delta: 0 }} />);
    expect(screen.getByText("免加價")).toBeVisible();
    view.rerender(<OptionPrice option={{ original_price_delta: null, price_delta: 0 }} />);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("已登記商品的比較價包含原始規格加價，實付價仍取優惠分配", () => {
    const order = {
      activity_id: null, subtotal_price: 350, discount_amount: 35, total_price: 315,
      items: [{ product_id: "shirt", quantity: 1, unit_price: 350,
        selected_options: [{ price_delta: 50, original_price_delta: 100 }] }],
    } as OrderOut;
    expect(shopCardPrice(shirt, [promotion], null, order)).toEqual({
      original: 500, current: 315, note: "依已登記 1 件計算",
    });
  });

  it("未設定與相同原價不顯示折扣，舊商品仍以售價計算", () => {
    const price = shopCardPrice({ id: "legacy", price: 300 }, [], null, null);
    const view = render(<ShopPrice {...price} />);
    expect(view.container.querySelector("del")).toBeNull();
    view.rerender(<ShopPrice original={300} current={300} />);
    expect(view.container.querySelector("del")).toBeNull();
  });

  it("登記後管理端再調價，仍以原價與已登記金額比較", () => {
    const repriced = { ...shirt, price: 350 };
    const items = [{ product_id: "shirt", quantity: 1, unit_price: 350,
      selected_options: [{ price_delta: 50, original_price_delta: 100 }] }];
    expect(registrationReferenceSubtotal(items, new Map([[shirt.id, repriced]]))).toBe(500);
    const order = { activity_id: null, subtotal_price: 350, discount_amount: 35,
      total_price: 315, items } as OrderOut;
    expect(shopCardPrice(repriced, [promotion], null, order).original).toBe(500);
    expect(registrationReferenceSubtotal(items, new Map([[shirt.id, { price: 350 }]]))).toBe(400);
  });
});
