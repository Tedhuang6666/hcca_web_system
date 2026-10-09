import { describe, expect, it } from "vitest";
import type { OrderListItem } from "@/lib/types";
import { groupActivityPreorders } from "./shop-preorders";

const order: OrderListItem = {
  id: "collected", serial_number: "001", user_id: "student", class_id: "class",
  activity_id: "festival", activity_name: "校慶", assistance_scope: "self",
  status: "pending", is_class_collected: true, is_paid: false,
  created_at: "2026-10-10T00:00:00Z", payment_method: "cash_on_pickup",
  total_price: 180, subtotal_price: 200, discount_amount: 20,
  items: [{ id: "bag", product_id: "bag", product_name: "紀念袋", quantity: 2,
    unit_price: 100, subtotal: 200, selected_options: [] }],
};

describe("依活動彙整預購", () => {
  it("merges later additions into the items while retaining only the uncollected amount", () => {
    const [group] = groupActivityPreorders([order, {
      ...order, id: "added", is_class_collected: false,
      total_price: 100, subtotal_price: 100, discount_amount: 0,
      items: [{ ...order.items![0], id: "added-bag", quantity: 1, subtotal: 100 }],
    }]);
    expect(group.items).toMatchObject([{ product_name: "紀念袋", quantity: 3, subtotal: 300 }]);
    expect(group).toMatchObject({ amount: 280, received: 180, outstanding: 100 });
    expect(order.items![0].quantity).toBe(2);
  });

  it("excludes cancellations and refunds, and never mixes activities or unlinked categories", () => {
    const groups = groupActivityPreorders([
      order, { ...order, id: "cancelled", status: "cancelled" },
      { ...order, id: "refunded", status: "refunded" },
      { ...order, id: "other", activity_id: "christmas", activity_name: "聖誕" },
      { ...order, id: "category-a", activity_id: null, category_id: "a" },
      { ...order, id: "category-b", activity_id: null, category_id: "b" },
    ]);
    expect(groups.map((group) => group.key)).toEqual(["festival", "christmas", "category:a", "category:b"]);
    expect(groups[0].amount).toBe(180);
    expect(groups[0].items[0].quantity).toBe(2);
  });

  it("keeps variants and historical prices separate and treats council-confirmed payments as paid", () => {
    const [group] = groupActivityPreorders([order, {
      ...order, id: "paid", is_class_collected: false, is_paid: true,
      items: [{ ...order.items![0], id: "variant", selected_options: [
        { option_id: "red", group_id: "color", group_name: "顏色", value: "紅", price_delta: 0 },
      ] }],
    }, {
      ...order, id: "new-price", class_id: null, is_class_collected: true, is_paid: false,
      items: [{ ...order.items![0], id: "expensive", unit_price: 120, subtotal: 240 }],
    }]);
    expect(group.items).toHaveLength(3);
    expect(group).toMatchObject({ amount: 540, received: 360, outstanding: 180 });
    expect(groupActivityPreorders([])).toEqual([]);
  });
});
