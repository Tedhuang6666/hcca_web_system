import type { ShopPromotionPublicOut } from "@/lib/types";

export function promotionGiftProducts(promotion: ShopPromotionPublicOut) {
  if (promotion.discount_type === "percentage" && promotion.discount_value === 100) {
    return promotion.target_products ?? [];
  }
  if (promotion.discount_type === "price_override") {
    return (promotion.product_price_overrides ?? [])
      .filter((row) => row.unit_price === 0)
      .map((row) => ({ id: row.product_id, name: row.product_name }));
  }
  return [];
}
