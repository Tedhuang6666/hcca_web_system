import type { CatalogProductOut, OrderOut, ShopPromotionPublicOut } from "@/lib/types";

export function bundleProductAvailable(product: CatalogProductOut | undefined, now = Date.now()) {
  return Boolean(product && product.status === "active"
    && (product.is_unlimited || product.stock_quantity > 0)
    && (!product.sale_start || new Date(product.sale_start).getTime() <= now)
    && (!product.sale_end || new Date(product.sale_end).getTime() > now));
}

export function bundleProgress(
  promotion: ShopPromotionPublicOut,
  products: ReadonlyMap<string, CatalogProductOut>,
  registration: Pick<OrderOut, "items"> | null,
) {
  const targets = promotion.target_products ?? [];
  const quantities = new Map<string, number>();
  for (const item of registration?.items ?? []) {
    quantities.set(item.product_id, (quantities.get(item.product_id) ?? 0) + item.quantity);
  }
  const completedSets = targets.length
    ? Math.min(...targets.map((target) => quantities.get(target.id) ?? 0)) : 0;
  const started = targets.some((target) => (quantities.get(target.id) ?? 0) > completedSets);
  const missing = completedSets > 0 && !started ? []
    : targets.filter((target) => (quantities.get(target.id) ?? 0) <= completedSets);
  const pricesKnown = targets.length > 0 && targets.every((target) => products.has(target.id));
  const original = pricesKnown
    ? targets.reduce((sum, target) => sum + products.get(target.id)!.price, 0) : null;
  return {
    quantities, completedSets, missing, started,
    original,
    saving: original == null ? null : Math.max(0, original - promotion.discount_value),
    unavailable: targets.length === 0 || missing.some((target) => !bundleProductAvailable(products.get(target.id))),
  };
}
