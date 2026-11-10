import { ChevronDown } from "lucide-react";
import type { ShopPromotionPublicOut } from "@/lib/types";

export default function TopicOffers({ promotions }: { promotions: ShopPromotionPublicOut[] }) {
  const offers = promotions.filter((promotion) => !promotion.target_products?.length
    && (promotion.discount_type === "fixed" || promotion.discount_type === "percentage"));
  if (!offers.length) return null;

  return <section className="shop-topic-offers" aria-label="主題優惠">
    <details className="shop-product-card-disclosure">
      <summary>主題優惠（{offers.length} 項）<ChevronDown size={15} aria-hidden="true" /></summary>
      <ul className="shop-topic-offer-list">
        {offers.map((promotion) => {
          const conditions = [
            promotion.min_order_price > 0 ? `滿 NT$${promotion.min_order_price.toLocaleString()}` : null,
            promotion.min_quantity > 1 ? `滿 ${promotion.min_quantity} 件` : null,
          ].filter(Boolean).join("、");
          const discount = promotion.discount_type === "percentage"
            ? `減價 ${promotion.discount_value}%` : `折抵 NT$${promotion.discount_value.toLocaleString()}`;
          return <li key={promotion.id}>
            <strong>{promotion.name}</strong>
            <p>{conditions && `${conditions}，`}{discount}
              {promotion.code ? ` · 優惠碼 ${promotion.code}` : " · 自動套用"}</p>
            {promotion.description && <p className="whitespace-pre-line">{promotion.description}</p>}
          </li>;
        })}
      </ul>
    </details>
  </section>;
}
