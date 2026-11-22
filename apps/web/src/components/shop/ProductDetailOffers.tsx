import { ChevronDown, Gift } from "lucide-react";
import type { OrderOut, ShopPromotionPublicOut } from "@/lib/types";
import { promotionGiftProducts } from "@/lib/shop-promotion-display";
import styles from "./ProductDetailOffers.module.css";

type RegistrationState = "ready" | "loading" | "error";

function offerDescription(promotion: ShopPromotionPublicOut, productId: string) {
  if (promotion.discount_type === "bundle_price") {
    return `組合價 NT$${promotion.discount_value.toLocaleString()}／套；每項各 1 件，規格加價另計。`;
  }
  if (promotion.discount_type === "price_override") {
    const price = promotion.product_price_overrides?.find((row) => row.product_id === productId);
    return price ? `本商品基本售價 NT$${price.unit_price.toLocaleString()}；規格加價另計。` : "指定商品各自適用優惠價。";
  }
  return promotion.discount_type === "percentage"
    ? `適用商品折抵 ${promotion.discount_value}%`
    : `每筆登記折抵 NT$${promotion.discount_value.toLocaleString()}`;
}

export default function ProductDetailOffers({ product, promotions, registration, registrationState = "ready" }: {
  product: { id: string; name: string; price: number };
  promotions: ShopPromotionPublicOut[];
  registration: OrderOut | null;
  registrationState?: RegistrationState;
}) {
  const matching = promotions.filter((promotion) => !promotion.target_products?.length
    || promotion.target_products.some((target) => target.id === product.id));
  const allocations = new Map<string, NonNullable<OrderOut["applied_promotions"]>[number]>();
  if (registrationState === "ready") {
    for (const row of registration?.applied_promotions ?? []) {
      if (row.discount_amount <= 0) continue;
      const previous = allocations.get(row.promotion_id);
      allocations.set(row.promotion_id, { ...row, discount_amount: (previous?.discount_amount ?? 0) + row.discount_amount });
    }
  }
  const applied = [...allocations.values()];
  if (registrationState === "ready" && !applied.length && registration?.promotion_id
    && registration.discount_amount > 0) {
    applied.push({
      promotion_id: registration.promotion_id,
      name: promotions.find((row) => row.id === registration.promotion_id)?.name
        ?? registration.promotion_code ?? "登記優惠",
      code: registration.promotion_code,
      discount_amount: registration.discount_amount,
    });
  }
  const otherApplied = applied.filter((row) => !matching.some((promotion) => promotion.id === row.promotion_id));
  if (!matching.length && !otherApplied.length) return null;

  const quantity = registration?.items.filter((item) => item.product_id === product.id)
    .reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const pendingMessage = registrationState === "loading" ? "正在確認優惠與贈品狀態…"
    : "無法確認優惠與贈品狀態，請重新載入後再確認。";

  return <section className={styles.offers} aria-label="優惠與贈品">
    <details key={product.id} className={styles.disclosure}>
      <summary className={styles.summary}>
        <h4>優惠與贈品
          <span className={styles.overview}>
            共 {matching.length + otherApplied.length} 項
            {registrationState === "ready" && applied.length > 0 && ` · 已套用 ${applied.length} 項`}
          </span>
        </h4>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <ul className={styles.list}>
        {matching.map((promotion) => {
          const allocation = applied.find((row) => row.promotion_id === promotion.id);
          const giftProducts = promotionGiftProducts(promotion);
          const isGift = giftProducts.some((row) => row.id === product.id);
          const companions = promotion.target_products?.filter((target) => target.id !== product.id) ?? [];
          const topic = "target_category_ids" in promotion && promotion.target_category_ids != null ? "單一活動" : "";
          const conditions = [
            promotion.min_order_price > 0 ? `${topic}滿 NT$${promotion.min_order_price.toLocaleString()}` : null,
            promotion.min_quantity > 1 ? `${topic}滿 ${promotion.min_quantity} 件` : null,
            promotion.code ? `優惠碼 ${promotion.code}` : null,
          ].filter(Boolean).join(" · ");
          return <li key={promotion.id} aria-label={promotion.name} className={styles.offer} data-gift={isGift || undefined}>
            <div className={styles.heading}>
              <h5>{promotion.name}</h5>
              {isGift && <span className={styles.giftLabel}><Gift size={15} aria-hidden="true" />贈品</span>}
            </div>
            {registrationState === "ready" && <p className={styles.state} data-applied={Boolean(allocation)}>
              {isGift ? quantity === 0 ? "尚未登記贈品"
                : `已登記 ${quantity} 件，${allocation ? "已套用贈品優惠" : "尚未套用贈品優惠"}`
                : allocation ? "已套用" : "尚未套用"}
            </p>}
            {allocation && <p className={styles.saving}>本筆登記折抵 NT${allocation.discount_amount.toLocaleString()}</p>}
            {isGift ? <>
              <p className={styles.giftName}>贈品：{giftProducts.map((row) => row.name).join("、")}</p>
              <p>{promotion.discount_type === "percentage"
                ? `每項贈送 ${promotion.gift_quantity ?? 1} 件，基本售價 NT$0；可加購多件，超出件數與規格加價另計。`
                : "符合條件時基本售價 NT$0；規格加價另計。"}</p>
              <p>贈品須自行選規格並登記。</p>
            </> : <p>{offerDescription(promotion, product.id)}</p>}
            {promotion.discount_type === "bundle_price" && <p>{promotion.target_products?.map((row) => row.name).join(" ＋ ")}</p>}
            {promotion.discount_type !== "price_override" && promotion.discount_type !== "bundle_price" && companions.length > 0
              && <p>需同時選購{companions.map((row) => row.name).join("、")}</p>}
            {conditions && <p>{conditions}</p>}
            {promotion.description && <p className="whitespace-pre-line">{promotion.description}</p>}
          </li>;
        })}
        {otherApplied.map((row) => <li key={row.promotion_id} aria-label={row.name} className={styles.offer}>
          <div className={styles.heading}><h5>{row.name}</h5></div>
          <p className={styles.state} data-applied>已套用 · 同筆登記優惠</p>
          <p className={styles.saving}>本筆登記折抵 NT${row.discount_amount.toLocaleString()}</p>
          {row.code && <p>使用優惠碼 {row.code}</p>}
        </li>)}
      </ul>
    </details>
    {registrationState !== "ready" && <p role="status" className={styles.note}>{pendingMessage}</p>}
  </section>;
}
