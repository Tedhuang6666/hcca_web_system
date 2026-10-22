import type { CatalogProductOut, OrderOut, ShopPromotionPublicOut } from "@/lib/types";
import { ArrowRight, ChevronDown } from "lucide-react";
import ShopPrice from "./ShopPrice";
import { bundleProgress } from "@/lib/shop-bundle-progress";

export default function BundleOffer({ promotion, products, registration, disabled, onSelect }: {
  promotion: ShopPromotionPublicOut;
  products: Map<string, CatalogProductOut>;
  registration: OrderOut | null;
  disabled: boolean;
  onSelect: (productId: string) => void;
}) {
  const targets = promotion.target_products ?? [];
  const { original, missing, started, completedSets, unavailable, saving } = bundleProgress(promotion, products, registration);
  const complete = targets.length > 0 && missing.length === 0;
  const applied = registration?.applied_promotions?.some((row) => row.promotion_id === promotion.id)
    || registration?.promotion_id === promotion.id;
  const next = missing[0] ?? targets[0];
  return <article className="shop-bundle-offer" data-started={started || undefined} aria-label={promotion.name}>
    <div className="shop-bundle-heading">
      <h3>{promotion.name}</h3>
      <p>{targets.map((target) => target.name).join(" ＋ ")}</p>
    </div>
    <div className="shop-bundle-footer">
      <div className="shop-bundle-price">
        <ShopPrice original={original ?? promotion.discount_value} current={promotion.discount_value} suffix="／套" />
        {saving != null && saving > 0 && <strong>每套省 NT${saving.toLocaleString()}</strong>}
      </div>
      <button type="button" className="shop-bundle-start" disabled={disabled || unavailable || !next}
        onClick={() => next && onSelect(next.id)}>
        {unavailable ? "暫停供應" : complete ? "調整套組" : started ? "繼續湊組" : "選購套組"}
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </div>
    {(started || completedSets > 0) && <p className="shop-bundle-status" role="status">
      {completedSets > 0 && `已湊齊 ${completedSets} 套${applied ? "，已套用優惠" : ""}。`}
      {started && `再選${missing.map((target) => target.name).join("、")}各 1 件即可湊組。`}
    </p>}
    <details className="shop-bundle-conditions">
      <summary>優惠條件<ChevronDown size={14} aria-hidden="true" /></summary>
      <p>每項各一件，自由選規格。
        {promotion.code ? ` 使用優惠碼 ${promotion.code}。` : " 符合條件自動套用。"}
        {promotion.min_order_price > 0 && ` 需滿 NT$${promotion.min_order_price.toLocaleString()}。`}
        {promotion.min_quantity > 1 && ` 指定商品合計需滿 ${promotion.min_quantity} 件。`}
        {" "}折扣依登記合計擇優套用，規格加價與未成套商品另計。</p>
    </details>
  </article>;
}
