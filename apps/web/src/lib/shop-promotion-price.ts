import type { OrderOut, ShopPromotionPublicOut } from "@/lib/types";

// 單品價只呈現能明確歸屬該商品的優惠；整筆、滿額與套組折扣顯示於登記合計。
export function productOfferPrice(
  product: { id: string; price: number },
  promotions: ShopPromotionPublicOut[],
  activityId: string | null,
  registration: OrderOut | null,
  variantDelta = 0,
  quantity = 1,
): number {
  const original = (product.price + variantDelta) * quantity;
  let best = original;
  for (const promotion of promotions) {
    if ((promotion.activity_id ?? null) !== activityId) continue;
    if (registration && !registration.applied_promotions?.some((row) => row.promotion_id === promotion.id)
      && registration.promotion_id !== promotion.id) continue;
    if (promotion.code && !registration?.applied_promotions?.some((row) => row.promotion_id === promotion.id)
      && registration?.promotion_id !== promotion.id) continue;
    if (promotion.min_quantity > quantity || promotion.min_order_price > original) continue;
    const targets = promotion.target_products ?? [];
    if (targets.length && !targets.some((row) => row.id === product.id)) continue;
    if (promotion.discount_type === "price_override") {
      const price = promotion.product_price_overrides?.find((row) => row.product_id === product.id);
      if (price) best = Math.min(best, (price.unit_price + variantDelta) * quantity);
    } else if (targets.length <= 1 && promotion.discount_type === "percentage") {
      best = Math.min(best, original - Math.floor(original * promotion.discount_value / 100));
    }
  }
  return Math.max(0, best);
}
