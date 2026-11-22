import type { OrderItemOut } from "@/lib/types";

type DraftItem = {
  product_id: string;
  option_ids: string[];
  quantity: number;
  unit_price: number;
};

// Option order is irrelevant; different prices and variants remain separate.
export function mergeDraftItems<T extends DraftItem>(items: readonly T[]): T[] {
  const groups = new Map<string, T>();
  for (const item of items) {
    const key = JSON.stringify([item.product_id, [...item.option_ids].sort(), item.unit_price]);
    const existing = groups.get(key);
    groups.set(key, existing ? { ...existing, quantity: existing.quantity + item.quantity } : { ...item });
  }
  return [...groups.values()];
}

export function summarizeOrderItems(items: readonly OrderItemOut[]): string {
  return orderItemDisplayRows(mergeOrderItems(items)).map((item) => {
    const variant = item.selected_options.map((option) => option.value).join("／");
    return `${item.product_name ?? "商品"}${variant ? `（${variant}）` : ""}${item.is_gift ? "【贈品】" : ""} × ${item.quantity}`;
  }).join("、");
}

// 合併顯示時也合併贈品快照，避免不同登記來源把免費件數遺失或重複套用。
export function mergeOrderItems(items: readonly OrderItemOut[]): OrderItemOut[] {
  const groups = new Map<string, OrderItemOut>();
  for (const item of items) {
    const key = JSON.stringify([item.product_id,
      item.selected_options.map((option) => option.option_id).sort(), item.unit_price]);
    const previous = groups.get(key);
    groups.set(key, previous ? {
      ...previous,
      quantity: previous.quantity + item.quantity,
      subtotal: previous.subtotal + item.subtotal,
      gift_quantity: (previous.gift_quantity ?? 0) + (item.gift_quantity ?? 0),
      gift_discount_amount: (previous.gift_discount_amount ?? 0) + (item.gift_discount_amount ?? 0),
    } : { ...item });
  }
  return [...groups.values()];
}

export function orderItemDisplayRows(items: readonly OrderItemOut[]) {
  return items.flatMap((item) => {
    const gift = Math.max(0, Math.min(item.quantity, item.gift_quantity ?? 0));
    const purchased = item.quantity - gift;
    return [
      ...(purchased > 0 ? [{ ...item, display_id: `${item.id}:purchase`, is_gift: false,
        quantity: purchased, subtotal: purchased * item.unit_price }] : []),
      ...(gift > 0 ? [{ ...item, display_id: `${item.id}:gift`, is_gift: true,
        quantity: gift, subtotal: Math.max(0, gift * item.unit_price - (item.gift_discount_amount ?? 0)) }] : []),
    ];
  });
}
