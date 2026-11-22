import type { CatalogProductOut, OrderOut, ShopPromotionPublicOut } from "@/lib/types";
import { productOrderable } from "@/lib/shop-deadlines";
import { referencePrice } from "@/lib/shop-reference-price";

export function bundleProductAvailable(product: CatalogProductOut | undefined, now = Date.now()) {
  return Boolean(product && productOrderable(product, now));
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
    ? targets.reduce((sum, target) => sum + referencePrice(products.get(target.id)!), 0) : null;
  return {
    quantities, completedSets, missing, started,
    original,
    saving: original == null ? null : Math.max(0, original - promotion.discount_value),
    unavailable: targets.length === 0 || missing.some((target) => !bundleProductAvailable(products.get(target.id))),
  };
}

export function bundleReplacedByBetterPromotion(
  promotion: ShopPromotionPublicOut,
  promotions: readonly ShopPromotionPublicOut[],
  products: ReadonlyMap<string, CatalogProductOut>,
  registration: OrderOut | null,
) {
  if (!registration) return false;
  const applied = registration.applied_promotions?.length ? registration.applied_promotions
    : registration.promotion_id ? [{ promotion_id: registration.promotion_id, discount_amount: registration.discount_amount }] : [];
  if (applied.some((row) => row.promotion_id === promotion.id)) return false;

  const targets = promotion.target_products ?? [];
  if (targets.length < 2 || targets.some((target) => !products.has(target.id))) return false;
  const quantities = new Map<string, number>();
  for (const item of registration.items) {
    quantities.set(item.product_id, (quantities.get(item.product_id) ?? 0)
      + Math.max(0, item.quantity - (item.gift_quantity ?? 0)));
  }
  const sets = Math.min(...targets.map((target) => quantities.get(target.id) ?? 0));
  const saving = targets.reduce((sum, target) => sum + products.get(target.id)!.price, 0)
    - promotion.discount_value;
  if (sets < 1 || saving <= 0 || registration.subtotal_price < promotion.min_order_price
    || targets.reduce((sum, target) => sum + (quantities.get(target.id) ?? 0), 0) < promotion.min_quantity) return false;

  let competingDiscount = 0;
  for (const allocation of applied) {
    if (allocation.discount_amount <= 0) continue;
    const other = promotions.find((row) => row.id === allocation.promotion_id && row.discount_type === "bundle_price");
    const otherTargets = other?.target_products ?? [];
    if (!other || otherTargets.length < 2 || !otherTargets.some((row) => targets.some((target) => target.id === row.id))
      || otherTargets.some((target) => !products.has(target.id))) continue;
    const unitSaving = otherTargets.reduce((sum, target) => sum + products.get(target.id)!.price, 0)
      - other.discount_value;
    // 只根據實際折抵推算已成套件數；價格資料不足或異動時不猜測取代原因。
    const reservedSets = allocation.discount_amount / unitSaving;
    if (unitSaving <= 0 || !Number.isInteger(reservedSets)
      || otherTargets.some((target) => (quantities.get(target.id) ?? 0) < reservedSets)) continue;
    for (const target of otherTargets) {
      quantities.set(target.id, (quantities.get(target.id) ?? 0) - reservedSets);
    }
    competingDiscount += allocation.discount_amount;
  }
  return competingDiscount > saving * sets && targets.some((target) => (quantities.get(target.id) ?? 0) === 0);
}
