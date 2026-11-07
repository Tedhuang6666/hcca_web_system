import type { OrderOut, ShopPromotionPublicOut } from "@/lib/types";

// 單品報價顯示符合購買條件的最低價；跨商品合購與套組折扣顯示於登記合計。
export function productOfferPrice(
  product: { id: string; price: number; category_id?: string | null },
  promotions: ShopPromotionPublicOut[],
  activityId: string | null,
  registration: OrderOut | null,
  variantDelta = 0,
  quantity = 1,
  categoryId?: string | null,
): number {
  const original = (product.price + variantDelta) * quantity;
  let best = original;
  for (const promotion of promotions) {
    if (promotion.target_category_ids == null) {
      if ((promotion.activity_id ?? null) !== activityId) continue;
    } else if (promotion.target_category_ids.length > 0
      && !promotion.target_category_ids.includes(categoryId ?? product.category_id ?? "")) continue;
    // 舊登記未套用的自動優惠也可能適用本次購買；優惠碼仍須先兌換。
    if (promotion.code && !registration?.applied_promotions?.some((row) => row.promotion_id === promotion.id)
      && registration?.promotion_id !== promotion.id) continue;
    if (promotion.min_quantity > quantity || promotion.min_order_price > original) continue;
    const targets = promotion.target_products ?? [];
    if (targets.length && !targets.some((row) => row.id === product.id)) continue;
    if (promotion.discount_type === "price_override") {
      const price = promotion.product_price_overrides?.find((row) => row.product_id === product.id);
      if (price) best = Math.min(best, (price.unit_price + variantDelta) * quantity);
    } else if (targets.length <= 1 && promotion.discount_type === "percentage") {
      const discount = promotion.discount_value === 100 && targets.length > 0
        ? product.price * quantity : Math.floor(original * promotion.discount_value / 100);
      best = Math.min(best, original - discount);
    } else if (targets.length <= 1 && promotion.discount_type === "fixed") {
      best = Math.min(best, original - promotion.discount_value);
    }
  }
  return Math.max(0, best);
}
