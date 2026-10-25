import { shopApi } from "@/lib/api";
import { orderScopeKey } from "@/lib/shop-order-scope";
import type { OrderOut, ShopPromotionPreviewOut } from "@/lib/types";

function automaticPromotionMatches(order: OrderOut, preview: ShopPromotionPreviewOut): boolean {
  const applied = order.applied_promotions ?? [];
  if (!preview.eligible) {
    return preview.discount_amount === 0
      && order.discount_amount === 0
      && order.promotion_id == null
      && applied.length === 0;
  }

  return preview.promotion_code == null
    && order.discount_amount === preview.discount_amount
    && order.promotion_id != null
    && applied.length === 1
    && applied[0].promotion_id === order.promotion_id
    && applied[0].name === preview.promotion_name
    && applied[0].code == null
    && applied[0].discount_amount === preview.discount_amount;
}

/** Re-evaluates saved, unpaid automatic promotions against the current settings. */
export async function refreshAutomaticRegistrationPromotions(orders: OrderOut[]): Promise<OrderOut[]> {
  const refreshed = [...orders];
  const seenScopes = new Set<string>();

  for (const order of orders) {
    const scopeKey = orderScopeKey(order);
    if (seenScopes.has(scopeKey)) continue;
    seenScopes.add(scopeKey);

    if (order.test_product_id || order.is_paid || order.is_class_collected || !order.items.length
      || order.status === "cancelled" || order.status === "refunded"
      || order.promotion_code?.trim()) continue;

    const activityId = order.activity_id ?? null;
    const categoryId = activityId ? null : order.category_id ?? null;

    try {
      const preview = await shopApi.previewCurrentPromotion(null, activityId, categoryId);
      if (automaticPromotionMatches(order, preview)) continue;

      const updated = await shopApi.applyCurrentPromotion(null, activityId, categoryId);
      const index = refreshed.findIndex((candidate) => candidate.id === updated.id);
      if (index >= 0) {
        refreshed[index] = updated;
      } else {
        const scopedIndex = refreshed.findIndex((candidate) => orderScopeKey(candidate) === scopeKey);
        if (scopedIndex >= 0) refreshed[scopedIndex] = updated;
      }
    } catch {
      // Keep displaying the saved order; the next refresh retries the promotion check.
    }
  }

  return refreshed;
}
