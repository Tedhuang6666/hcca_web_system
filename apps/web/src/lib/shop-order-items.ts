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
  const merged = mergeDraftItems(items.map((item) => ({
    ...item, option_ids: item.selected_options.map((option) => option.option_id),
  })));
  return merged.map((item) => {
    const variant = item.selected_options.map((option) => option.value).join("／");
    return `${item.product_name ?? "商品"}${variant ? `（${variant}）` : ""} × ${item.quantity}`;
  }).join("、");
}
