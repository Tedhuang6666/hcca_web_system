import { describe, expect, it } from "vitest";
import { mergeOrderItems, orderItemDisplayRows, summarizeOrderItems } from "./shop-order-items";
import { groupActivityPreorders } from "./shop-preorders";
import type { OrderListItem } from "./types";

const item = { id: "item", product_id: "shirt", product_name: "紀念衫", quantity: 3,
  unit_price: 150, subtotal: 450, selected_options: [], gift_quantity: 1, gift_discount_amount: 100 };

describe("贈品明細快照", () => {
  it("分列只用後端已套用的贈品件數，保留所有實際件數與規格加價", () => {
    const rows = orderItemDisplayRows([item]);
    expect(rows.map((row) => [row.is_gift, row.quantity, row.subtotal])).toEqual([
      [false, 2, 300], [true, 1, 50],
    ]);
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(3);
    expect(summarizeOrderItems([item])).toBe("紀念衫 × 2、紀念衫【贈品】 × 1");
  });

  it("合併多筆同商品／規格時保留贈品份額，不增加免費額度", () => {
    const items = [item, { ...item, id: "extra", quantity: 2, subtotal: 300,
      gift_quantity: 0, gift_discount_amount: 0 }];
    expect(mergeOrderItems(items)[0]).toMatchObject({ quantity: 5, gift_quantity: 1, gift_discount_amount: 100 });
    expect(orderItemDisplayRows(mergeOrderItems(items)).map((row) => row.quantity)).toEqual([4, 1]);
    const order: OrderListItem = { id: "order", status: "pending", is_paid: false, is_class_collected: false,
      serial_number: "TEST-001", user_id: "student", payment_method: "cash_on_pickup",
      created_at: "2026-11-09T00:00:00Z", subtotal_price: 750, discount_amount: 100,
      assistance_scope: "self", total_price: 650, items };
    expect(groupActivityPreorders([order])[0].items[0]).toMatchObject({ quantity: 5, gift_quantity: 1 });
  });
});
