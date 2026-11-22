import type { OrderOut, ShopPromotionPublicOut } from "./types";
import { productOfferPrice } from "./shop-promotion-price";
import { referencePrice, registrationReferenceSubtotal } from "./shop-reference-price";

export type ShopCardPrice = { original: number; current: number; note?: string };

// 已登記品項的價格取自實際折抵結果，不再以「只買一件」重新判斷優惠門檻。
export function shopCardPrice(
  product: { id: string; price: number; original_price?: number | null },
  promotions: ShopPromotionPublicOut[],
  activityId: string | null,
  registration: OrderOut | null,
  categoryId?: string | null,
): ShopCardPrice {
  const fallback = {
    original: referencePrice(product),
    current: productOfferPrice(product, promotions, activityId, registration, 0, 1, categoryId),
  };
  if (!registration || (registration.activity_id ?? null) !== activityId
    || registration.discount_amount <= 0) return fallback;
  const items = registration.items.filter((item) => item.quantity > 0);
  const selected = items.filter((item) => item.product_id === product.id);
  const quantity = selected.reduce((sum, item) => sum + item.quantity, 0);
  const gross = selected.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const subtotal = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  if (!quantity || subtotal <= 0 || subtotal !== registration.subtotal_price
    || registration.total_price + registration.discount_amount !== subtotal) return fallback;

  let discount = 0;
  if (items.every((item) => item.product_id === product.id)) {
    // 同一商品即使優惠隱藏、附門檻或疊加優惠碼，實付金額仍能準確換算單價。
    discount = registration.discount_amount;
  } else {
    const allocations = registration.applied_promotions ?? [];
    if (!allocations.length) return fallback;
    for (const allocation of allocations) {
      const promotion = promotions.find((row) => row.id === allocation.promotion_id);
      // 未知條件與整套價格不能冒充某一單品的折後價格。
      if (!promotion || promotion.discount_type === "bundle_price"
        || (promotion.target_category_ids == null && (promotion.activity_id ?? null) !== activityId)) return fallback;
      // 主題門檻折抵不能按整張跨主題訂單的金額比例分攤成單品價。
      if (promotion.target_category_ids != null && (promotion.discount_type !== "price_override"
        || promotion.min_order_price > 0 || promotion.min_quantity > 1)) return fallback;
      const targets = new Set((promotion.target_products ?? []).map((target) => target.id));
      const weights = items.map((item) => {
        if (targets.size && !targets.has(item.product_id)) return 0;
        if (promotion.discount_type !== "price_override") return item.unit_price * item.quantity;
        const override = promotion.product_price_overrides?.find((row) => row.product_id === item.product_id);
        if (!override) return 0;
        const delta = item.selected_options.reduce((sum, option) => sum + (option.price_delta ?? 0), 0);
        return Math.max(0, item.unit_price - delta - override.unit_price) * item.quantity;
      });
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      const productWeight = weights.reduce((sum, weight, index) =>
        sum + (items[index].product_id === product.id ? weight : 0), 0);
      if (totalWeight > 0) discount += allocation.discount_amount * productWeight / totalWeight;
    }
  }
  if (discount <= 0) return fallback;
  const current = Math.max(0, gross - discount) / quantity;
  const original = registrationReferenceSubtotal(selected, new Map([[product.id, product]])) / quantity;
  return {
    original: Math.round(original * 100) / 100,
    current: Math.round(current * 100) / 100,
    note: !Number.isInteger(current) ? "折後平均單價（約）" : `依已登記 ${quantity} 件計算`,
  };
}
