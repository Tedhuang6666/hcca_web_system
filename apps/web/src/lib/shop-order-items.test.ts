import { describe, expect, it } from "vitest";
import { mergeDraftItems, summarizeOrderItems } from "./shop-order-items";

describe("商品明細彙整", () => {
  it("merges identical variants irrespective of option order without mutating input", () => {
    const first = { product_id: "p", option_ids: ["size", "color"], unit_price: 120, quantity: 2 };
    expect(mergeDraftItems([first, { ...first, option_ids: ["color", "size"], quantity: 3 }]))
      .toEqual([{ ...first, quantity: 5 }]);
    expect(first.quantity).toBe(2);
  });
  it("keeps different products, variants and price snapshots separate", () => {
    const item = { product_id: "p", option_ids: ["red"], unit_price: 100, quantity: 1 };
    expect(mergeDraftItems([item, { ...item, product_id: "q" }, { ...item, option_ids: ["blue"] }, { ...item, unit_price: 120 }])).toHaveLength(4);
  });
  it("shows historical duplicates once with variant details", () => {
    const item = { id: "i", product_id: "p", product_name: "班服", quantity: 1, unit_price: 100, subtotal: 100, selected_options: [] };
    expect(summarizeOrderItems([item, { ...item, id: "j", quantity: 2, subtotal: 200 }])).toBe("班服 × 3");
    expect(summarizeOrderItems([])).toBe("");
  });
});
